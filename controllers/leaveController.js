const leaveService = require('../services/leaveService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class LeaveController {
  /**
   * Get leave balances for a user
   * GET /api/leave/balances/:userEmail
   */
  getLeaveBalances = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const balances = await leaveService.getLeaveBalances(userEmail);

    logger.business('Leave Balances Retrieved', {
      event: 'leave_balances_retrieved',
      userEmail,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'BALANCES_RETRIEVED',
      balances,
      message: 'Balances retrieved successfully',
    });
  });

  /**
   * Submit a leave request
   * POST /api/leave/request
   */
  submitLeaveRequest = catchAsync(async (req, res) => {
    const { userEmail, leaveType, startDate, endDate, reason, totalHours } = req.body;

    const result = await leaveService.submitLeaveRequest({
      userEmail,
      leaveType,
      startDate,
      endDate,
      reason,
      totalHours,
    });

    logger.business('Leave Request Submitted', {
      event: 'leave_request_submitted',
      userEmail,
      leaveType,
      startDate,
      endDate,
      totalHours,
      requestId: result.requestId,
      timestamp: new Date().toISOString()
    });

    return res.status(201).json({
      success: true,
      code: 'LEAVE_REQUEST_SUBMITTED',
      requestId: result.requestId,
      status: 'Pending',
      message: 'Leave request submitted',
    });
  });

  /**
   * Get leave requests for a user
   * GET /api/leave/requests/:userEmail
   */
  getLeaveRequests = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const requests = await leaveService.getLeaveRequests(userEmail);

    logger.business('Leave Requests Retrieved', {
      event: 'leave_requests_retrieved',
      userEmail,
      count: requests?.length || 0,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'LEAVE_REQUESTS_RETRIEVED',
      requests,
    });
  });

  /**
   * Get leave forecast
   * GET /api/leave/forecast/:userEmail
   */
  getLeaveForecast = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { targetDate } = req.query;

    const forecast = await leaveService.getLeaveForecast(userEmail, targetDate);

    logger.business('Leave Forecast Retrieved', {
      event: 'leave_forecast_retrieved',
      userEmail,
      targetDate,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'FORECAST_RETRIEVED',
      data: forecast,
    });
  });

  /**
   * Get public holidays
   * GET /api/leave/public-holidays
   */
  getPublicHolidays = catchAsync(async (req, res) => {
    const organizationId = req.query.organizationId || null;
    const year = req.query.year || new Date().getFullYear();

    const holidays = await leaveService.getPublicHolidays(organizationId, year);

    logger.business('Public Holidays Retrieved', {
      event: 'public_holidays_retrieved',
      organizationId,
      year,
      count: holidays?.length || 0,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'HOLIDAYS_RETRIEVED',
      holidays,
    });
  });

  /**
   * Update leave balance
   * PUT /api/leave/balances/:userEmail
   */
  updateLeaveBalance = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { leaveType, hours, reason } = req.body;

    const balance = await leaveService.updateLeaveBalance(userEmail, leaveType, hours, reason);

    logger.business('Leave Balance Updated', {
      event: 'leave_balance_updated',
      userEmail,
      leaveType,
      hours,
      reason,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'BALANCE_UPDATED',
      data: balance,
      message: 'Leave balance updated successfully',
    });
  });
}

module.exports = new LeaveController();
