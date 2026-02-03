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

module.exports = {
  getFinancialMetrics,
  getUtilizationMetrics,
  getOvertimeMetrics,
  getReliabilityMetrics,
  getCrossOrgMetrics,
  getRevenueForecast,
  getPricingAnalytics,
  getPricingComplianceReport
};
