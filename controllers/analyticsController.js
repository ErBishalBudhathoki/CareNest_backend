const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');
const crossOrgService = require('../services/crossOrgService');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const WorkedTime = require('../models/WorkedTime');
const ClientAssignment = require('../models/ClientAssignment');
const User = require('../models/User');
const mongoose = require('mongoose');

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
const getFinancialMetrics = catchAsync(async (req, res) => {
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

    // 1. Revenue (from invoiceLineItems)
    const revenueData = await InvoiceLineItem.aggregate([
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
    ]);

    // 2. Labor Cost (from workedTime joined with users)
    const laborData = await WorkedTime.aggregate([
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
    ]);

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

/**
 * Get Utilization Metrics
 * GET /api/analytics/utilization
 */
const getUtilizationMetrics = catchAsync(async (req, res) => {
    const orgId = req.params.organizationId || req.query.organizationId;
    const { startDate, endDate } = req.query;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Calculate total weeks in range for capacity
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0); // Start of day

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include full end date

    const weeks = Math.max(1, (end - start) / (1000 * 60 * 60 * 24 * 7));
    const capacityPerEmployee = 40 * weeks;

    // Aggregate Billable Hours per Employee (from invoiceLineItems)
    const utilizationData = await InvoiceLineItem.aggregate([
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
    ]);

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

/**
 * Get Overtime Hotspots
 * GET /api/analytics/overtime
 */
const getOvertimeMetrics = catchAsync(async (req, res) => {
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

    const overtimeData = await WorkedTime.aggregate([
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
    ]);

    res.status(200).json({
      success: true,
      data: overtimeData
    });
});

/**
 * Get Reliability Metrics
 * GET /api/analytics/reliability
 */
const getReliabilityMetrics = catchAsync(async (req, res) => {
    const orgId = req.params.organizationId || req.query.organizationId;
    const { startDate, endDate } = req.query;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // Extract YYYY-MM-DD part for string comparison against date fields
    const startStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
    const endStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;

    // 1. Get All Scheduled Shifts in Range (Past dates only for reliability)
    const scheduledShifts = await ClientAssignment.aggregate([
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
    ]);

    // 2. Get All Worked Shifts in Range
    const workedShifts = await WorkedTime.aggregate([
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
    ]);

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

/**
 * Get Cross-Org Revenue
 * GET /api/analytics/cross-org/revenue
 */
const getCrossOrgMetrics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    const userId = req.user.id; // Assumes auth middleware populates user

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start and End dates are required' });
    }

    const result = await crossOrgService.getCrossOrgRevenue(userId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: result
    });
});

/**
 * Get Revenue Forecast
 * GET /api/analytics/forecast
 */
const getRevenueForecast = catchAsync(async (req, res) => {
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
});

/**
 * Get Pricing Analytics
 * GET /api/analytics/pricing/:organizationId
 */
const getPricingAnalytics = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { startDate, endDate, clientId } = req.query;
    
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }
    
    // Build date filter
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Build organization filter
    const orgFilter = { organizationId, ...dateFilter };
    if (clientId) {
      orgFilter.clientId = clientId;
    }
    
    // Get custom pricing data
    const customPricing = await mongoose.connection.db.collection('customPricing').find(orgFilter).toArray();
    
    // Get invoice line items for pricing analysis
    const invoiceItems = await InvoiceLineItem.find(orgFilter);
    
    // Calculate pricing metrics
    const totalItems = invoiceItems.length;
    const customPricedItems = invoiceItems.filter(item => item.pricingSource === 'custom');
    const standardPricedItems = invoiceItems.filter(item => item.pricingSource === 'standard');
    const ndisPricedItems = invoiceItems.filter(item => item.pricingSource === 'ndis');
    
    const totalRevenue = invoiceItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const customRevenue = customPricedItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const standardRevenue = standardPricedItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const ndisRevenue = ndisPricedItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    
    // Calculate compliance metrics
    const compliantItems = invoiceItems.filter(item => item.isCompliant !== false);
    const complianceRate = totalItems > 0 ? (compliantItems.length / totalItems) * 100 : 0;
    
    const metrics = {
      totalItems,
      customPricedItems: customPricedItems.length,
      standardPricedItems: standardPricedItems.length,
      ndisPricedItems: ndisPricedItems.length,
      customPricingPercentage: totalItems > 0 ? (customPricedItems.length / totalItems) * 100 : 0,
      totalRevenue,
      customRevenue,
      standardRevenue,
      ndisRevenue,
      complianceRate,
      compliantItems: compliantItems.length,
      nonCompliantItems: totalItems - compliantItems.length
    };
    
    // Log analytics access
    logger.business('Pricing Analytics Accessed', {
      event: 'pricing_analytics_accessed',
      organizationId,
      userEmail: req.user?.email || 'system',
      dateRange: { startDate, endDate },
      filters: { clientId },
      metrics: {
        customPricingCount: customPricing.length,
        invoiceItemsCount: invoiceItems.length,
        totalRevenue,
        complianceRate
      },
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      message: 'Pricing analytics retrieved successfully',
      data: {
        metrics,
        summary: {
          totalCustomPricing: customPricing.length,
          totalInvoiceItems: invoiceItems.length,
          dateRange: { startDate, endDate },
          organizationId,
          generatedAt: new Date().toISOString()
        }
      }
    });
});

/**
 * Get Pricing Compliance Report
 * GET /api/analytics/pricing/compliance/:organizationId
 */
const getPricingComplianceReport = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { startDate, endDate, threshold = 0.95 } = req.query;
    
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }
    
    // Build filter
    const filter = { organizationId };
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Get compliance data
    const invoiceItems = await InvoiceLineItem.find(filter);
    const totalItems = invoiceItems.length;
    const compliantItems = invoiceItems.filter(item => item.isCompliant !== false);
    const nonCompliantItems = invoiceItems.filter(item => item.isCompliant === false);
    
    const overallCompliance = totalItems > 0 ? (compliantItems.length / totalItems) * 100 : 0;
    
    // Identify violations
    const violations = nonCompliantItems.map(item => ({
      itemId: item._id,
      clientId: item.clientId,
      supportItemNumber: item.supportItemNumber,
      unitPrice: item.unitPrice,
      violationType: item.violationType || 'price_cap_exceeded',
      severity: item.unitPrice > 200 ? 'critical' : item.unitPrice > 100 ? 'high' : 'medium',
      amount: item.totalPrice,
      date: item.createdAt
    }));
    
    // Generate recommendations
    const recommendations = [];
    if (overallCompliance < threshold * 100) {
      recommendations.push({
        type: 'compliance',
        priority: 'high',
        message: `Compliance rate (${overallCompliance.toFixed(2)}%) is below threshold (${(threshold * 100)}%)`,
        action: 'Review and adjust pricing to meet NDIS compliance requirements'
      });
    }
    
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    if (criticalViolations.length > 0) {
      recommendations.push({
        type: 'critical_violations',
        priority: 'urgent',
        message: `${criticalViolations.length} critical pricing violations found`,
        action: 'Immediately review and correct items with prices exceeding $200'
      });
    }
    
    logger.business('Pricing Compliance Report Generated', {
      event: 'pricing_compliance_report',
      organizationId,
      complianceData: {
        overallCompliance,
        totalViolations: violations.length,
        criticalViolations: criticalViolations.length
      },
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      success: true,
      message: 'Pricing compliance report generated successfully',
      data: {
        compliance: {
          totalItems,
          compliantItems: compliantItems.length,
          nonCompliantItems: nonCompliantItems.length,
          overallCompliance,
          complianceGrade: overallCompliance >= 95 ? 'A' : overallCompliance >= 85 ? 'B' : overallCompliance >= 70 ? 'C' : 'D'
        },
        violations,
        recommendations,
        summary: {
          overallCompliance,
          meetsThreshold: overallCompliance >= threshold * 100,
          totalViolations: violations.length,
          generatedAt: new Date().toISOString()
        }
      }
    });
});

/**
 * Get Worker Churn Predictions
 * GET /api/analytics/churn-prediction
 */
const getChurnPrediction = catchAsync(async (req, res) => {
    const orgId = req.query.organizationId;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    const predictionService = require('../services/predictionService');
    
    // Get worker data for the organization
    const workers = await User.find({
      organizationId: orgId,
      role: { $in: ['employee', 'worker'] },
      isActive: true
    });

    // Get historical data for predictions
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const todayStr = new Date().toISOString().split('T')[0];
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // Get worked time data
    const workedTimeData = await WorkedTime.aggregate([
      {
        $match: {
          shiftDate: { $gte: thirtyDaysAgoStr, $lte: todayStr }
        }
      },
      {
        $lookup: {
          from: 'clientAssignments',
          localField: 'assignedClientId',
          foreignField: '_id',
          as: 'assignment'
        }
      },
      { $unwind: { path: '$assignment', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { organizationId: orgId },
            { 'assignment.organizationId': orgId }
          ]
        }
      },
      {
        $group: {
          _id: '$userEmail',
          totalShifts: { $sum: 1 },
          noShows: {
            $sum: {
              $cond: [{ $eq: ['$status', 'no-show'] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Get scheduled shifts data
    const scheduledShifts = await ClientAssignment.aggregate([
      {
        $match: {
          organizationId: orgId,
          isActive: true
        }
      },
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
                    date: { $arrayElemAt: ["$dateList", "$idx"] },
                    startTime: { $arrayElemAt: ["$startTimeList", "$idx"] }
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
          "schedule.date": { $gte: thirtyDaysAgoStr, $lte: todayStr }
        }
      },
      {
        $group: {
          _id: '$userEmail',
          offeredShifts: { $sum: 1 }
        }
      }
    ]);

    // Create lookup maps
    const workedTimeMap = new Map(workedTimeData.map(w => [w._id, w]));
    const scheduledMap = new Map(scheduledShifts.map(s => [s._id, s]));

    // Calculate churn predictions for each worker
    const predictions = [];
    
    for (const worker of workers) {
      const workedData = workedTimeMap.get(worker.email) || { totalShifts: 0, noShows: 0 };
      const scheduledData = scheduledMap.get(worker.email) || { offeredShifts: 0 };
      
      const workerMetrics = {
        email: worker.email,
        totalShifts: workedData.totalShifts,
        noShows: workedData.noShows,
        offeredShifts: scheduledData.offeredShifts,
        daysSinceLastShift: 0, // Would need to calculate from last shift date
        rating: worker.rating || 0
      };

      const prediction = predictionService.predictWorkerChurn(workerMetrics, worker);
      
      // Only include workers with medium or high risk
      if (prediction.churnScore >= 40) {
        predictions.push(prediction);
      }
    }

    // Sort by churn score (highest first)
    predictions.sort((a, b) => b.churnScore - a.churnScore);

    logger.business('Churn Prediction Generated', {
      event: 'churn_prediction_generated',
      organizationId: orgId,
      totalWorkers: workers.length,
      atRiskWorkers: predictions.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: predictions
    });
});

/**
 * Get Demand Forecast
 * GET /api/analytics/demand-forecast
 */
const getDemandForecast = catchAsync(async (req, res) => {
    const orgId = req.query.organizationId;
    const daysAhead = parseInt(req.query.daysAhead) || 7;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    const predictionService = require('../services/predictionService');

    // Get historical appointment data (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    // Get historical worked time data
    const historicalData = await WorkedTime.aggregate([
      {
        $match: {
          shiftDate: { $gte: ninetyDaysAgoStr, $lte: todayStr }
        }
      },
      {
        $lookup: {
          from: 'clientAssignments',
          localField: 'assignedClientId',
          foreignField: '_id',
          as: 'assignment'
        }
      },
      { $unwind: { path: '$assignment', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { organizationId: orgId },
            { 'assignment.organizationId': orgId }
          ]
        }
      },
      {
        $group: {
          _id: {
            date: '$shiftDate',
            serviceType: { $ifNull: ['$assignment.serviceType', 'General'] }
          },
          count: { $sum: 1 },
          hours: {
            $push: {
              $toInt: {
                $arrayElemAt: [
                  { $split: ['$startTime', ':'] },
                  0
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          serviceTypes: {
            $push: {
              type: '$_id.serviceType',
              count: '$count'
            }
          },
          totalCount: { $sum: '$count' },
          allHours: { $push: '$hours' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Generate forecast
    const forecast = predictionService.forecastDemand(historicalData, daysAhead);

    logger.business('Demand Forecast Generated', {
      event: 'demand_forecast_generated',
      organizationId: orgId,
      daysAhead,
      historicalDataPoints: historicalData.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: forecast
    });
});

/**
 * Get Compliance Risk Assessment
 * GET /api/analytics/compliance-risk
 */
const getComplianceRisk = catchAsync(async (req, res) => {
    const orgId = req.query.organizationId;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    const predictionService = require('../services/predictionService');

    // Get all workers in the organization
    const workers = await User.find({
      organizationId: orgId,
      role: { $in: ['employee', 'worker'] },
      isActive: true
    });

    // Get organization data
    const Organization = require('../models/Organization');
    const organization = await Organization.findOne({ organizationId: orgId });

    // Collect compliance data
    const complianceData = {
      organizationId: orgId,
      workers: workers.map(w => ({
        id: w._id.toString(),
        name: `${w.firstName} ${w.lastName}`,
        email: w.email,
        certifications: w.certifications || [],
        documents: w.documents || [],
        trainings: w.trainings || [],
        lastAudit: w.lastComplianceAudit || null
      })),
      organizationSettings: {
        requiredCertifications: organization?.requiredCertifications || [
          'First Aid',
          'CPR',
          'NDIS Worker Screening'
        ],
        requiredDocuments: organization?.requiredDocuments || [
          'Police Check',
          'Working with Children Check',
          'Insurance Certificate'
        ],
        requiredTrainings: organization?.requiredTrainings || [
          'Manual Handling',
          'Infection Control',
          'Privacy & Confidentiality'
        ]
      }
    };

    // Assess compliance risk
    const riskAssessment = predictionService.assessComplianceRisk(complianceData);

    logger.business('Compliance Risk Assessment Generated', {
      event: 'compliance_risk_assessment',
      organizationId: orgId,
      overallScore: riskAssessment.overallScore,
      riskLevel: riskAssessment.riskLevel,
      totalIssues: riskAssessment.issues.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: riskAssessment
    });
});

/**
 * Get Client Risk Predictions
 * GET /api/analytics/client-risk
 */
const getClientRisk = catchAsync(async (req, res) => {
    const orgId = req.params.organizationId || req.query.organizationId;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Get all clients for the organization
    const clients = await ClientAssignment.find({ organizationId: orgId })
      .populate('clientId')
      .lean();

    if (!clients || clients.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const clientRiskPredictions = [];

    // Calculate risk for each client
    for (const assignment of clients) {
      if (!assignment.clientId) continue;

      const clientId = assignment.clientId._id.toString();
      const clientName = assignment.clientId.name || 'Unknown Client';

      // Get client metrics (mock data for now - replace with actual queries)
      const metrics = {
        totalInvoices: Math.floor(Math.random() * 50) + 10,
        latePayments: Math.floor(Math.random() * 10),
        totalAppointments: Math.floor(Math.random() * 100) + 20,
        cancellations: Math.floor(Math.random() * 15),
        complaints: Math.floor(Math.random() * 3),
        escalations: Math.floor(Math.random() * 2),
        avgResponseTime: Math.floor(Math.random() * 72) + 12,
        recentAppointments: Math.floor(Math.random() * 30) + 10,
        historicalAverage: 25,
        monthsAsClient: Math.floor(Math.random() * 24) + 3
      };

      const clientData = {
        _id: assignment.clientId._id,
        name: clientName
      };

      const riskPrediction = predictionService.predictClientRisk(clientData, metrics);
      clientRiskPredictions.push(riskPrediction);
    }

    // Sort by risk score (highest first)
    clientRiskPredictions.sort((a, b) => b.riskScore - a.riskScore);

    // Limit to top 20 at-risk clients
    const topRisks = clientRiskPredictions.filter(c => c.riskScore > 30).slice(0, 20);

    logger.business('Client Risk Predictions Generated', {
      event: 'client_risk_prediction',
      organizationId: orgId,
      totalClients: clientRiskPredictions.length,
      highRiskClients: topRisks.filter(c => c.riskLevel === 'high').length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: topRisks
    });
});

/**
 * Get Service Demand Predictions
 * GET /api/analytics/service-demand
 */
const getServiceDemand = catchAsync(async (req, res) => {
    const orgId = req.params.organizationId || req.query.organizationId;
    const daysAhead = parseInt(req.query.daysAhead) || 30;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Get historical appointment data by service type (last 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const historicalData = await ClientAssignment.aggregate([
      {
        $match: {
          organizationId: orgId,
          createdAt: { $gte: sixtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            serviceType: "$serviceType"
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: "$_id.date",
          serviceTypes: {
            $push: {
              type: "$_id.serviceType",
              count: "$count"
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Predict service demand
    const demandPrediction = predictionService.predictServiceDemand(historicalData, daysAhead);

    logger.business('Service Demand Predictions Generated', {
      event: 'service_demand_prediction',
      organizationId: orgId,
      daysAhead,
      serviceTypes: demandPrediction.predictions.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: demandPrediction
    });
});

/**
 * Run Scenario Model
 * POST /api/analytics/scenario-model
 */
const runScenarioModel = catchAsync(async (req, res) => {
    const orgId = req.params.organizationId || req.body.organizationId;
    const scenario = req.body.scenario;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    if (!scenario) {
      return res.status(400).json({ success: false, message: 'Scenario parameters are required' });
    }

    // Get baseline data (mock for now - replace with actual queries)
    const baselineData = {
      currentRevenue: 50000,
      currentExpenses: 35000,
      workerCount: 20,
      clientCount: 50,
      utilizationRate: 0.75
    };

    // Run scenario model
    const results = predictionService.runScenarioModel(baselineData, scenario);

    logger.business('Scenario Model Executed', {
      event: 'scenario_model',
      organizationId: orgId,
      scenarioName: scenario.name,
      revenueChange: results.changes.revenueChange,
      profitChange: results.changes.profitChange,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: results
    });
});

/**
 * Get AI Recommendations
 * GET /api/analytics/recommendations
 */
const getRecommendations = catchAsync(async (req, res) => {
    const orgId = req.params.organizationId || req.query.organizationId;

    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Gather all analytics data (simplified - in production, call actual endpoints)
    const analyticsData = {
      churnPredictions: [],
      clientRisks: [],
      serviceDemand: { predictions: [], recommendations: [] },
      complianceRisk: { riskLevel: 'low', overallScore: 85 },
      revenueForecast: []
    };

    // Generate recommendations
    const recommendations = predictionService.generateRecommendations(analyticsData);

    logger.business('AI Recommendations Generated', {
      event: 'ai_recommendations',
      organizationId: orgId,
      recommendationCount: recommendations.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      data: recommendations
    });
});

module.exports = {
  getFinancialMetrics,
  getUtilizationMetrics,
  getOvertimeMetrics,
  getReliabilityMetrics,
  getCrossOrgMetrics,
  getRevenueForecast,
  getPricingAnalytics,
  getPricingComplianceReport,
  getChurnPrediction,
  getDemandForecast,
  getComplianceRisk,
  getClientRisk,
  getServiceDemand,
  runScenarioModel,
  getRecommendations
};
