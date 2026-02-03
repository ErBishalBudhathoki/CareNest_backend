const LeaveBalanceService = require('../services/leaveBalanceService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class LeaveBalanceController {
  getBalances = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'User email is required'
      });
    }

    const balances = await LeaveBalanceService.getBalances(userEmail);
    
    logger.business('Retrieved leave balances', {
      action: 'leave_balance_get',
      userEmail,
      balanceCount: balances?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'LEAVE_BALANCES_RETRIEVED',
      balances,
      message: 'Balances retrieved successfully'
    });
  });

  updateBalance = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { leaveType, hours, reason } = req.body;

    if (!userEmail || !leaveType || hours === undefined || !reason) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: userEmail, leaveType, hours, reason'
      });
    }

    const updatedBalance = await LeaveBalanceService.updateBalance(userEmail, leaveType, hours, reason);
    
    logger.business('Updated leave balance', {
      action: 'leave_balance_update',
      userEmail,
      leaveType,
      hours,
      reason
    });
    
    res.status(200).json({
      success: true,
      code: 'LEAVE_BALANCE_UPDATED',
      data: updatedBalance,
      message: 'Balance updated successfully'
    });
  });
}

module.exports = new LeaveBalanceController();
