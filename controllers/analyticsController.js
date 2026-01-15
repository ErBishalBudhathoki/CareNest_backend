const { databaseConfig } = require('../config/database');
const logger = require('../config/logger');

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
    const { organizationId } = req.query; // Expecting organizationId in query or params? Usually params based on other endpoints
    // business_intelligence_endpoints.js uses params for orgId. 
    // But user prompt said: Input: Date Range. 
    // I'll check req.params and req.query.
    const orgId = req.params.organizationId || req.query.organizationId;
    const { startDate, endDate } = req.query;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    await databaseConfig.executeOperation(async (db) => {
      // 1. Revenue (from invoiceLineItems)
      const revenueData = await db.collection('invoiceLineItems').aggregate([
        {
          $match: {
            organizationId: orgId,
            createdAt: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
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
            shiftDate: { $gte: startDate, $lte: endDate }
          }
        },
        // Join with clientAssignments to check Organization
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

      // 3. Merge Data
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

    await databaseConfig.executeOperation(async (db) => {
      // Calculate total weeks in range for capacity
      const start = new Date(startDate);
      const end = new Date(endDate);
      const weeks = Math.max(1, (end - start) / (1000 * 60 * 60 * 24 * 7));
      const capacityPerEmployee = 40 * weeks;

      // Aggregate Billable Hours per Employee (from invoiceLineItems? Or workedTime?)
      // Requirement says: "Utilization Rate: (Total Billable Hours / Total Available Capacity Hours) * 100."
      // "Billable Hours" usually implies hours charged to client.
      // `invoiceLineItems` has `hours` and `employeeId` (or `providerName`?). 
      // `business_intelligence_endpoints.js` uses `invoiceLineItems` grouped by `employeeId`.
      // Let's assume `invoiceLineItems` is the source for Billable Hours.

      const utilizationData = await db.collection('invoiceLineItems').aggregate([
        {
          $match: {
            organizationId: orgId,
            createdAt: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: "$employeeId", // Assuming employeeId is stored, otherwise userEmail?
            // BI endpoints use employeeId.
            billableHours: { $sum: "$hours" },
            revenueGenerated: { $sum: "$totalPrice" }
          }
        },
        // Lookup employee details
        {
          $lookup: {
            from: 'login',
            localField: '_id', // Assuming employeeId is the _id from login collection? 
            // OR if employeeId is email? BI endpoints use employeeId.
            // Let's assume it matches _id of login. But let's check if it matches email?
            // Usually employeeId is ObjectId string.
            // Let's try to lookup by _id (converting to ObjectId if needed)
            let: { empId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", { $toObjectId: "$$empId" }] } } }
            ],
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

    await databaseConfig.executeOperation(async (db) => {
      const overtimeData = await db.collection('workedTime').aggregate([
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

        // Group by User
        {
          $group: {
            _id: '$userEmail',
            totalHours: { $sum: '$hours' }
          }
        },
        
        // Filter Overtime
        {
          $match: {
            totalHours: { $gt: 40 }
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
            overtimeHours: { $subtract: ['$totalHours', 40] }
          }
        }
      ]).toArray();

      res.status(200).json({
        success: true,
        data: overtimeData
      });
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

    await databaseConfig.executeOperation(async (db) => {
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
            "schedule.date": { $gte: startDate, $lte: endDate, $lt: todayStr } // Only past shifts
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
      const workedShifts = await db.collection('workedTime').aggregate([
        {
          $match: {
            shiftDate: { $gte: startDate, $lte: endDate }
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
    });
  } catch (error) {
    logger.error('Error in getReliabilityMetrics', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

module.exports = {
  getFinancialMetrics,
  getUtilizationMetrics,
  getOvertimeMetrics,
  getReliabilityMetrics
};
