const LeaveBalanceService = require('../services/leaveBalanceService');
const logger = require('../config/logger');

class LeaveBalanceController {
  async getBalances(req, res) {
    try {
      const { userEmail } = req.params;
      if (!userEmail) {
        return res.status(400).json({ success: false, message: 'User email is required' });
      }

      const balances = await LeaveBalanceService.getBalances(userEmail);
      res.status(200).json({
        success: true,
        balances,
        message: 'Balances retrieved successfully'
      });
    } catch (error) {
      logger.error('Error getting leave balances', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error getting leave balances'
      });
    }
  }

  async updateBalance(req, res) {
    try {
      const { userEmail } = req.params;
      const { leaveType, hours, reason } = req.body;

      if (!userEmail || !leaveType || hours === undefined || !reason) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      const updatedBalance = await LeaveBalanceService.updateBalance(userEmail, leaveType, hours, reason);
      res.status(200).json({
        success: true,
        data: updatedBalance,
        message: 'Balance updated successfully'
      });
    } catch (error) {
      logger.error('Error updating leave balance', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error updating leave balance'
      });
    }
  }
}

module.exports = new LeaveBalanceController();
