const leaveService = require('../services/leaveService');
const logger = require('../config/logger');

class LeaveController {
  async getLeaveBalances(req, res) {
    try {
      const { userEmail } = req.params;
      const balances = await leaveService.getLeaveBalances(userEmail);
      return res.status(200).json({
        success: true,
        balances,
        message: 'Balances retrieved successfully',
      });
    } catch (error) {
      logger.error('Error fetching leave balances', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching leave balances',
      });
    }
  }

  async submitLeaveRequest(req, res) {
    try {
      const { userEmail, leaveType, startDate, endDate, reason, totalHours } = req.body;
      if (!userEmail || !leaveType || !startDate || !endDate || !reason || totalHours == null) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields',
        });
      }
      const result = await leaveService.submitLeaveRequest({
        userEmail,
        leaveType,
        startDate,
        endDate,
        reason,
        totalHours,
      });
      return res.status(201).json({
        success: true,
        requestId: result.requestId,
        status: 'Pending',
        message: 'Leave request submitted',
      });
    } catch (error) {
      logger.error('Error submitting leave request', error);
      return res.status(500).json({
        success: false,
        message: 'Error submitting leave request',
      });
    }
  }

  async getLeaveRequests(req, res) {
    try {
      const { userEmail } = req.params;
      const requests = await leaveService.getLeaveRequests(userEmail);
      return res.status(200).json({
        success: true,
        requests,
      });
    } catch (error) {
      logger.error('Error fetching leave requests', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching leave requests',
      });
    }
  }

  async getLeaveForecast(req, res) {
    try {
      const { userEmail } = req.params;
      const { targetDate } = req.query;
      if (!targetDate) {
        return res.status(400).json({
          success: false,
          message: 'Missing targetDate',
        });
      }
      const forecast = await leaveService.getLeaveForecast(userEmail, targetDate);
      return res.status(200).json({
        success: true,
        data: forecast,
      });
    } catch (error) {
      logger.error('Error fetching leave forecast', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching leave forecast',
      });
    }
  }

  async getPublicHolidays(req, res) {
    try {
      const organizationId = req.query.organizationId || null;
      const year = req.query.year || new Date().getFullYear();
      const holidays = await leaveService.getPublicHolidays(organizationId, year);
      return res.status(200).json({
        success: true,
        holidays,
      });
    } catch (error) {
      logger.error('Error fetching public holidays', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching public holidays',
      });
    }
  }
}

module.exports = new LeaveController();
