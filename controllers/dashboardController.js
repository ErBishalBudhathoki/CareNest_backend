const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');
const ClientAssignment = require('../models/ClientAssignment');
const WorkedTime = require('../models/WorkedTime');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const User = require('../models/User');

/**
 * Dashboard Controller
 * Provides aggregated data for dashboard widgets
 */

/**
 * Get Today's Summary
 * GET /api/dashboard/today-summary
 */
const getTodaySummary = catchAsync(async (req, res) => {
  const { organizationId } = req.query;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // Get appointments today
  const appointments = await ClientAssignment.countDocuments({
    organizationId,
    isActive: true,
    'schedule.date': todayStr
  });

  // Get completed appointments
  const completedAppointments = await WorkedTime.countDocuments({
    organizationId,
    shiftDate: todayStr,
    status: 'completed'
  });

  // Get workers on shift today
  const workersOnShift = await WorkedTime.distinct('userEmail', {
    organizationId,
    shiftDate: todayStr
  });

  // Get active workers (currently working)
  const now = new Date();
  const currentHour = now.getHours();
  const activeWorkers = await WorkedTime.countDocuments({
    organizationId,
    shiftDate: todayStr,
    startTime: { $lte: `${currentHour}:00` },
    endTime: { $gte: `${currentHour}:00` }
  });

  // Get revenue today
  const revenueData = await InvoiceLineItem.aggregate([
    {
      $match: {
        organizationId,
        createdAt: { $gte: today }
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalPrice' }
      }
    }
  ]);

  const revenueToday = revenueData[0]?.totalRevenue || 0;

  // Get pending approvals (mock data - implement based on your approval system)
  const pendingApprovals = 5; // TODO: Implement actual approval count

  const summary = {
    appointmentsToday: appointments,
    workersOnShift: workersOnShift.length,
    revenueToday,
    pendingApprovals,
    completedAppointments,
    cancelledAppointments: 0, // TODO: Implement
    activeWorkers,
    availableWorkers: workersOnShift.length - activeWorkers,
    lastUpdated: new Date()
  };

  logger.business('Today Summary Retrieved', {
    event: 'today_summary_retrieved',
    organizationId,
    summary,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    data: summary
  });
});

/**
 * Get Worker Locations
 * GET /api/dashboard/worker-locations
 */
const getWorkerLocations = catchAsync(async (req, res) => {
  const { organizationId } = req.query;

  // In production, fetch from real-time location tracking service
  // For now, return mock data based on active workers
  const todayStr = new Date().toISOString().split('T')[0];
  
  const activeShifts = await WorkedTime.find({
    organizationId,
    shiftDate: todayStr
  }).populate('userEmail');

  const workerLocations = activeShifts.map(shift => ({
    workerId: shift.userEmail,
    workerName: shift.userName || 'Unknown',
    workerEmail: shift.userEmail,
    latitude: -37.8136 + (Math.random() - 0.5) * 0.1, // Mock location
    longitude: 144.9631 + (Math.random() - 0.5) * 0.1, // Mock location
    status: _determineWorkerStatus(shift),
    lastUpdated: new Date(),
    currentAppointmentId: shift.assignedClientId,
    currentClientName: shift.clientName
  }));

  logger.business('Worker Locations Retrieved', {
    event: 'worker_locations_retrieved',
    organizationId,
    count: workerLocations.length,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    data: workerLocations
  });
});

/**
 * Get Quick Actions
 * GET /api/dashboard/quick-actions
 */
const getQuickActions = catchAsync(async (req, res) => {
  const { organizationId } = req.query;

  // Count pending timesheets
  const pendingTimesheets = await WorkedTime.countDocuments({
    organizationId,
    status: 'pending'
  });

  // Count pending expenses (mock)
  const pendingExpenses = 3; // TODO: Implement actual expense count

  // Count unassigned shifts
  const unassignedShifts = await ClientAssignment.countDocuments({
    organizationId,
    isActive: true,
    userEmail: { $exists: false }
  });

  // Count unread messages (mock)
  const unreadMessages = 7; // TODO: Implement actual message count

  const quickActions = [
    {
      id: 'approve-timesheets',
      title: 'Approve Timesheets',
      icon: 'access_time',
      count: pendingTimesheets,
      type: 'approveTimesheets',
      route: '/timesheets/pending'
    },
    {
      id: 'review-expenses',
      title: 'Review Expenses',
      icon: 'receipt_long',
      count: pendingExpenses,
      type: 'reviewExpenses',
      route: '/expenses/pending'
    },
    {
      id: 'assign-shifts',
      title: 'Assign Shifts',
      icon: 'calendar_today',
      count: unassignedShifts,
      type: 'assignShifts',
      route: '/shifts/unassigned'
    },
    {
      id: 'send-messages',
      title: 'Messages',
      icon: 'message',
      count: unreadMessages,
      type: 'sendMessages',
      route: '/messages'
    }
  ];

  logger.business('Quick Actions Retrieved', {
    event: 'quick_actions_retrieved',
    organizationId,
    actions: quickActions.map(a => ({ type: a.type, count: a.count })),
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    data: quickActions
  });
});

/**
 * Get Compliance Alerts
 * GET /api/dashboard/compliance-alerts
 */
const getComplianceAlerts = catchAsync(async (req, res) => {
  const { organizationId } = req.query;

  const alerts = [];
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Check for expiring certifications
  const expiringCerts = await User.countDocuments({
    organizationId,
    'certifications.expiryDate': {
      $gte: now,
      $lte: thirtyDaysFromNow
    }
  });

  if (expiringCerts > 0) {
    alerts.push({
      id: 'expiring-certs',
      type: 'expiringCertifications',
      title: 'Certifications Expiring Soon',
      description: `${expiringCerts} worker certifications expire within 30 days`,
      count: expiringCerts,
      severity: 'high',
      dueDate: thirtyDaysFromNow,
      actionRoute: '/compliance/certifications'
    });
  }

  // Check for missing documents (mock)
  const missingDocs = 2; // TODO: Implement actual check
  if (missingDocs > 0) {
    alerts.push({
      id: 'missing-docs',
      type: 'missingDocuments',
      title: 'Missing Documents',
      description: `${missingDocs} workers have incomplete documentation`,
      count: missingDocs,
      severity: 'medium',
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      actionRoute: '/compliance/documents'
    });
  }

  // Check for overdue training (mock)
  const overdueTraining = 1; // TODO: Implement actual check
  if (overdueTraining > 0) {
    alerts.push({
      id: 'overdue-training',
      type: 'overdueTraining',
      title: 'Overdue Training',
      description: `${overdueTraining} workers have overdue training modules`,
      count: overdueTraining,
      severity: 'medium',
      dueDate: now,
      actionRoute: '/compliance/training'
    });
  }

  logger.business('Compliance Alerts Retrieved', {
    event: 'compliance_alerts_retrieved',
    organizationId,
    alertCount: alerts.length,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    data: alerts
  });
});

/**
 * Get Revenue Comparison
 * GET /api/dashboard/revenue-comparison
 */
const getRevenueComparison = catchAsync(async (req, res) => {
  const { organizationId } = req.query;

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const lastMonthStart = new Date(monthStart);
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

  // Get today's revenue
  const todayRevenue = await _getRevenue(organizationId, today, now);

  // Get yesterday's revenue
  const yesterdayRevenue = await _getRevenue(organizationId, yesterday, today);

  // Get week to date revenue
  const weekToDateRevenue = await _getRevenue(organizationId, weekStart, now);

  // Get last week revenue
  const lastWeekRevenue = await _getRevenue(organizationId, lastWeekStart, weekStart);

  // Get month to date revenue
  const monthToDateRevenue = await _getRevenue(organizationId, monthStart, now);

  // Get last month revenue
  const lastMonthRevenue = await _getRevenue(organizationId, lastMonthStart, monthStart);

  // Calculate percentages
  const todayVsYesterdayPercent = _calculatePercentChange(todayRevenue, yesterdayRevenue);
  const weekVsLastWeekPercent = _calculatePercentChange(weekToDateRevenue, lastWeekRevenue);
  const monthVsLastMonthPercent = _calculatePercentChange(monthToDateRevenue, lastMonthRevenue);

  // Get last 7 days data
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    
    const revenue = await _getRevenue(organizationId, date, nextDate);
    
    last7Days.push({
      date: date.toISOString(),
      revenue,
      expenses: revenue * 0.6, // Mock expenses
      profit: revenue * 0.4
    });
  }

  const comparison = {
    todayRevenue,
    yesterdayRevenue,
    weekToDateRevenue,
    monthToDateRevenue,
    todayVsYesterdayPercent,
    weekVsLastWeekPercent,
    monthVsLastMonthPercent,
    todayTrend: _getTrend(todayVsYesterdayPercent),
    weekTrend: _getTrend(weekVsLastWeekPercent),
    monthTrend: _getTrend(monthVsLastMonthPercent),
    last7Days,
    last30Days: [] // TODO: Implement if needed
  };

  logger.business('Revenue Comparison Retrieved', {
    event: 'revenue_comparison_retrieved',
    organizationId,
    todayRevenue,
    weekToDateRevenue,
    monthToDateRevenue,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    data: comparison
  });
});

// Helper functions

function _determineWorkerStatus(shift) {
  const now = new Date();
  const currentTime = `${now.getHours()}:${now.getMinutes()}`;
  
  if (shift.startTime <= currentTime && shift.endTime >= currentTime) {
    return 'atAppointment';
  } else if (shift.startTime > currentTime) {
    return 'enRoute';
  } else {
    return 'available';
  }
}

async function _getRevenue(organizationId, startDate, endDate) {
  const result = await InvoiceLineItem.aggregate([
    {
      $match: {
        organizationId,
        createdAt: {
          $gte: startDate,
          $lt: endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$totalPrice' }
      }
    }
  ]);

  return result[0]?.total || 0;
}

function _calculatePercentChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function _getTrend(percentChange) {
  if (percentChange > 5) return 'up';
  if (percentChange < -5) return 'down';
  return 'flat';
}

module.exports = {
  getTodaySummary,
  getWorkerLocations,
  getQuickActions,
  getComplianceAlerts,
  getRevenueComparison
};
