const connectDB = require('../config/mongoose');
const logger = require('../config/logger');
const crossOrgService = require('../services/crossOrgService');

/**
 * Analytics Controller
 * Handles requests for workforce analytics and financial metrics.
 */

/**
 * Helper to parse duration string to decimal hours
 * Supports "HH:MM:SS" and numeric strings
 */
const parseDurationExpression = {
  $let: {
    vars: {
      parts: { 
        $cond: {
          if: { $regexMatch: { input: "$timeWorked", regex: /:/ } },
          then: { $split: ["$timeWorked", ":"] },
          else: []
        }
      }
    },
    in: {
      $cond: {
        if: { $gt: [{ $size: "$$parts" }, 0] },
        then: {
          $add: [
            { $toInt: { $arrayElemAt: ["$$parts", 0] } },
            { $divide: [{ $toInt: { $arrayElemAt: ["$$parts", 1] } }, 60] },
            { $divide: [{ $toInt: { $arrayElemAt: ["$$parts", 2] } }, 3600] }
          ]
        },
        else: { $toDouble: "$timeWorked" }
      }
    }
  }
};

/**
 * Get Financial Metrics (Revenue vs Labor Cost)
 * GET /api/analytics/financials
 */
async function getFinancialMetrics(req, res) {
  try {
    // Expecting organizationId in query or params? Usually params based on other endpoints
    // business_intelligence_endpoints.js uses params for orgId. 
    // But user prompt said: Input: Date Range. 
    // I'll check req.params and req.query.
    const orgId = req.params.organizationId || req.query.organizationId;
    const { startDate, endDate } = req.query;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Adjust endDate to end of day to be inclusive
    const startDateTime = new Date(startDate);
    startDateTime.setHours(0, 0, 0, 0);
    
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999);

    // Extract YYYY-MM-DD part for string comparison against workedTime.shiftDate
    const startStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
    const endStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;

    await connectDB();
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    
      // 1. Revenue (from invoiceLineItems)
      const revenueData = await db.collection('invoiceLineItems').aggregate([
        {
          $match: {
            organizationId: orgId,
            createdAt: {
              $gte: startDateTime,
              $lte: endDateTime
            }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$totalPrice" }
          }
        }
      ]).toArray();

      // 2. Labor Cost (from workedTime joined with users)
      const laborData = await db.collection('workedTime').aggregate([
        // Filter by date range (shiftDate is string YYYY-MM-DD)
        {
          $match: {
            shiftDate: { $gte: startStr, $lte: endStr }
          }
        },
        // Normalize assignedClientId to ObjectId for lookup
        {
          $addFields: {
            lookupId: { $toObjectId: "$assignedClientId" }
          }
        },
        // Join with clientAssignments to check Organization
        {
          $lookup: {
            from: 'clientAssignments',
            localField: 'lookupId',
            foreignField: '_id',
            as: 'assignment'
          }
        },
        { $unwind: { path: '$assignment', preserveNullAndEmptyArrays: true } },
        // Match Organization ID (either from direct record or lookup)
        { 
          $match: { 
            $or: [
              { organizationId: orgId },
              { 'assignment.organizationId': orgId }
            ]
          } 
        },
        
        // Deduplicate: Get latest workedTime entry per shiftKey
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$shiftKey',
            doc: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$doc' } },

        // Join with Users to get PayRate
        {
          $lookup: {
            from: 'login',
            localField: 'userEmail',
            foreignField: 'email',
            as: 'user'
          }
        },
        { $unwind: '$user' },

        // Calculate Hours and Cost
        {
          $addFields: {
            hours: parseDurationExpression,
            payRate: { $ifNull: ['$user.payRate', 0] }
          }
        },
        {
          $addFields: {
            cost: { $multiply: ['$hours', '$payRate'] }
          }
        },
        
        // Group by Date
        {
          $group: {
            _id: '$shiftDate',
            laborCost: { $sum: '$cost' },
            totalHours: { $sum: '$hours' }
          }
        }
      ]).toArray();

      const mergedData = {};
      
      // Initialize with revenue data
      revenueData.forEach(r => {
        mergedData[r._id] = { date: r._id, revenue: r.revenue, laborCost: 0, margin: 0 };
      });

      // Merge labor data
      laborData.forEach(l => {
        if (!mergedData[l._id]) {
          mergedData[l._id] = { date: l._id, revenue: 0, laborCost: 0, margin: 0 };
        }
        mergedData[l._id].laborCost = l.laborCost;
      });

      // Calculate Margin and convert to array
      const result = Object.values(mergedData)
        .map(item => ({
          ...item,
          margin: item.revenue - item.laborCost
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.status(200).json({
        success: true,
        data: result
      });
  } catch (error) {
    logger.error('Error in getFinancialMetrics', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

/**
 * Get Utilization Metrics
 * GET /api/analytics/utilization
 */
async function getUtilizationMetrics(req, res) {
  try {
    const orgId = req.params.organizationId || req.query.organizationId;
    const { startDate, endDate } = req.query;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    await connectDB();
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;

      // Calculate total weeks in range for capacity
      const start = new Date(startDate);
    start.setHours(0, 0, 0, 0); // Start of day
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include full end date
      
    const weeks = Math.max(1, (end - start) / (1000 * 60 * 60 * 24 * 7));
      const capacityPerEmployee = 40 * weeks;

      // Aggregate Billable Hours per Employee (from invoiceLineItems)
      const utilizationData = await db.collection('invoiceLineItems').aggregate([
        {
          $match: {
            organizationId: orgId,
            createdAt: { $gte: start, $lte: end },
            employeeId: { $exists: true, $ne: null } // Filter out invalid IDs
          }
        },
        {
          $group: {
            _id: "$employeeId",
            billableHours: { $sum: "$hours" },
            revenueGenerated: { $sum: "$totalPrice" }
          }
        },
        // Lookup employee details with safe ID conversion
        {
          $addFields: {
            employeeObjId: {
              $convert: {
                input: "$_id",
                to: "objectId",
                onError: null,
                onNull: null
              }
            }
          }
        },
        {
          $lookup: {
            from: 'login',
            localField: 'employeeObjId',
            foreignField: '_id',
            as: 'employee'
          }
        },
        { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            employeeName: { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
            email: "$employee.email",
            billableHours: 1,
            revenueGenerated: 1
          }
        }
      ]).toArray();

      // Format Result
      const result = utilizationData.map(u => ({
        ...u,
        capacityHours: capacityPerEmployee,
        utilizationRate: (u.billableHours / capacityPerEmployee) * 100
      }));

      res.status(200).json({
        success: true,
        data: result
      });
  } catch (error) {
    logger.error('Error in getUtilizationMetrics', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

/**
 * Get Overtime Hotspots
 * GET /api/analytics/overtime
 */
async function getOvertimeMetrics(req, res) {
  try {
    const orgId = req.params.organizationId || req.query.organizationId;
    const { weekStart } = req.query; // YYYY-MM-DD of Monday

    if (!orgId || !weekStart) {
      return res.status(400).json({ success: false, message: 'Organization ID and weekStart are required' });
    }
    
    // Calculate week range
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    
    const startStr = weekStart;
    const endStr = end.toISOString().split('T')[0];

    await connectDB();
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;

      const overtimeData = await db.collection('worked_times').aggregate([
        {
          $match: {
            shiftDate: { $gte: startStr, $lte: endStr }
          }
        },
        // Normalize assignedClientId to ObjectId for lookup
        {
          $addFields: {
            lookupId: { $toObjectId: "$assignedClientId" }
          }
        },
        // Join to check Org
        {
          $lookup: {
            from: 'clientAssignments',
            localField: 'lookupId',
            foreignField: '_id',
            as: 'assignment'
          }
        },
        { $unwind: { path: '$assignment', preserveNullAndEmptyArrays: true } },
        // Match Organization ID (either from direct record or lookup)
        { 
          $match: { 
            $or: [
              { organizationId: orgId },
              { 'assignment.organizationId': orgId }
            ]
          } 
        },

        // Deduplicate Shifts
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$shiftKey',
            doc: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$doc' } },

        // Calculate Hours
        {
          $addFields: {
            hours: parseDurationExpression
          }
        },

        // Group by User and Date to find daily spikes
        {
          $group: {
            _id: {
              email: '$userEmail',
              date: '$shiftDate'
            },
            dailyHours: { $sum: '$hours' }
          }
        },
        
        // Aggregate back to User level with Daily details
        {
          $group: {
            _id: '$_id.email',
            totalHours: { $sum: '$dailyHours' },
            dailyBreakdown: {
              $push: {
                date: '$_id.date',
                hours: '$dailyHours'
              }
            }
          }
        },
        
        // Filter Overtime (Weekly > 40 OR Daily > 8 spike check)
        {
          $match: {
            totalHours: { $gt: 0 } // Get all active users to show heat map, not just overtime
          }
        },
        
        // Lookup User Details
        {
          $lookup: {
            from: 'login',
            localField: '_id',
            foreignField: 'email',
            as: 'user'
          }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        
        {
          $project: {
            employeeEmail: '$_id',
            employeeName: { $concat: ["$user.firstName", " ", "$user.lastName"] },
            totalHours: 1,
            overtimeHours: { 
              $cond: {
                if: { $gt: ['$totalHours', 40] },
                then: { $subtract: ['$totalHours', 40] },
                else: 0
              }
            },
            dailyBreakdown: 1
          }
        }
      ]).toArray();

      res.status(200).json({
        success: true,
        data: overtimeData
      });
  } catch (error) {
    logger.error('Error in getOvertimeMetrics', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

/**
 * Get Reliability Metrics
 * GET /api/analytics/reliability
 */
async function getReliabilityMetrics(req, res) {
  try {
    const orgId = req.params.organizationId || req.query.organizationId;
    const { startDate, endDate } = req.query;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    
    // Extract YYYY-MM-DD part for string comparison against date fields
    const startStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
    const endStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;

    await connectDB();
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;

      // 1. Get All Scheduled Shifts in Range (Past dates only for reliability)
      const scheduledShifts = await db.collection('clientAssignments').aggregate([
        {
          $match: {
            organizationId: orgId,
            isActive: true
          }
        },
        // Normalize schedule from legacy fields if needed
        {
          $addFields: {
            schedule: {
              $cond: {
                if: { $and: [{ $isArray: "$schedule" }, { $gt: [{ $size: "$schedule" }, 0] }] },
                then: "$schedule",
                else: {
                  $map: {
                    input: { $range: [0, { $size: { $ifNull: ["$dateList", []] } }] },
                    as: "idx",
                    in: {
                      date: { $arrayElemAt: ["$dateList", "$$idx"] },
                      startTime: { $arrayElemAt: ["$startTimeList", "$$idx"] },
                      endTime: { $arrayElemAt: ["$endTimeList", "$$idx"] },
                      break: { $arrayElemAt: ["$breakList", "$$idx"] }
                    }
                  }
                }
              }
            }
          }
        },
        { $unwind: "$schedule" },
        {
          $match: {
            "schedule.date": { $gte: startStr, $lte: endStr, $lt: todayStr } // Only past shifts
          }
        },
        {
          $project: {
            userEmail: 1,
            clientEmail: 1,
            date: "$schedule.date",
            startTime: "$schedule.startTime",
            // Construct a key to match workedTime
            shiftKey: { 
              $concat: ["$schedule.date", "_", "$schedule.startTime"] 
            }
          }
        }
      ]).toArray();

      // 2. Get All Worked Shifts in Range
      const workedShifts = await db.collection('worked_times').aggregate([
        {
          $match: {
            shiftDate: { $gte: startStr, $lte: endStr }
          }
        },
        // Join to check Org
        {
          $lookup: {
            from: 'clientAssignments',
            localField: 'assignedClientId',
            foreignField: '_id',
            as: 'assignment'
          }
        },
        { $unwind: '$assignment' },
        { $match: { 'assignment.organizationId': orgId } },
        
        // Deduplicate
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$shiftKey',
            doc: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$doc' } }
      ]).toArray();

      // Create a Set of worked shift keys for fast lookup
      const workedShiftKeys = new Set(workedShifts.map(w => w.shiftKey));

      // Calculate Metrics
      const employeeStats = {};
      
      scheduledShifts.forEach(shift => {
        if (!employeeStats[shift.userEmail]) {
          employeeStats[shift.userEmail] = { 
            scheduled: 0, 
            worked: 0, 
            noShow: 0 
          };
        }
        
        employeeStats[shift.userEmail].scheduled++;
        
        if (workedShiftKeys.has(shift.shiftKey)) {
          employeeStats[shift.userEmail].worked++;
        } else {
          employeeStats[shift.userEmail].noShow++;
        }
      });

      // Format Output
      const result = Object.keys(employeeStats).map(email => {
        const stats = employeeStats[email];
        return {
          employeeEmail: email,
          totalScheduled: stats.scheduled,
          filledShifts: stats.worked,
          noShows: stats.noShow,
          shiftFillRate: stats.scheduled ? (stats.worked / stats.scheduled) * 100 : 0,
          noShowRate: stats.scheduled ? (stats.noShow / stats.scheduled) * 100 : 0
        };
      });

      res.status(200).json({
        success: true,
        data: result
      });
  } catch (error) {
    logger.error('Error in getReliabilityMetrics', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

/**
 * Get Cross-Org Revenue
 * GET /api/analytics/cross-org/revenue
 */
async function getCrossOrgMetrics(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id; // Assumes auth middleware populates user

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start and End dates are required' });
    }

    await connectDB();
    const result = await crossOrgService.getCrossOrgRevenue(userId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error in getCrossOrgMetrics', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

/**
 * Get Revenue Forecast
 * GET /api/analytics/forecast
 */
async function getRevenueForecast(req, res) {
  try {
    // Placeholder implementation for forecast
    // In a real scenario, this would likely use historical data to project future revenue
    const orgId = req.params.organizationId || req.query.organizationId;
    
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    res.status(200).json({
      success: true,
      message: 'Revenue forecast feature coming soon',
      data: [] 
    });
  } catch (error) {
    logger.error('Error in getRevenueForecast', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

module.exports = {
  getFinancialMetrics,
  getUtilizationMetrics,
  getOvertimeMetrics,
  getReliabilityMetrics,
  getCrossOrgMetrics,
  getRevenueForecast
};
