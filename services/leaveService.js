const LeaveBalance = require('../models/LeaveBalance');
const User = require('../models/User');
const LeaveRequest = require('../models/LeaveRequest');
const PublicHoliday = require('../models/PublicHoliday');

class LeaveService {
  /**
   * Get leave balances for a user. Initializes if not exists.
   * @param {string} userEmail 
   * @returns {Promise<Object>} Map of leave types to balances
   */
  async getLeaveBalances(userEmail) {
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      throw new Error('User not found');
    }

    const leaveTypes = ['annual', 'sick', 'personal', 'longService'];
    let balances = await LeaveBalance.find({ userId: user._id });

    // Initialize if missing
    if (balances.length < leaveTypes.length) {
      const existingTypes = balances.map(b => b.leaveType);
      const missingTypes = leaveTypes.filter(t => !existingTypes.includes(t));

      const newBalances = missingTypes.map(type => ({
        userId: user._id,
        userEmail: userEmail,
        leaveType: type,
        currentBalance: 0,
        accruedHours: 0,
        usedHours: 0
      }));

      if (newBalances.length > 0) {
        await LeaveBalance.insertMany(newBalances);
        balances = await LeaveBalance.find({ userId: user._id });
      }
    }

    const balanceMap = {};
    balances.forEach(b => {
      balanceMap[b.leaveType] = b.currentBalance;
    });

    return {
      annualLeave: balanceMap['annual'] || 0,
      sickLeave: balanceMap['sick'] || 0,
      personalLeave: balanceMap['personal'] || 0,
      longServiceLeave: balanceMap['longService'] || 0
    };
  }

  /**
   * Submit a new leave request
   */
  async submitLeaveRequest({ userEmail, leaveType, startDate, endDate, reason, totalHours }) {
    const user = await User.findOne({ email: userEmail });
    if (!user) throw new Error('User not found');

    // Check balance before submitting
    const normalizedType = leaveType.toLowerCase().replace('leave', '').trim();
    const balance = await LeaveBalance.findOne({ userId: user._id, leaveType: normalizedType });

    if (!balance || (balance.currentBalance < totalHours)) {
      // Optional: Allow negative balance up to a limit
      if (!balance || (balance.currentBalance - totalHours < -40)) {
        throw new Error(`Insufficient ${leaveType} balance.`);
      }
    }

    const request = new LeaveRequest({
      userId: user._id,
      organizationId: user.organizationId,
      createdBy: userEmail,
      leaveType: normalizedType,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      totalHours,
      reason,
      status: 'Pending',
      history: [{
        action: 'created',
        performedBy: userEmail,
        timestamp: new Date()
      }]
    });

    await request.save();
    return { requestId: request._id };
  }

  /**
   * Get leave requests for a user
   */
  async getLeaveRequests(userEmail) {
    const user = await User.findOne({ email: userEmail });
    if (!user) throw new Error('User not found');

    return await LeaveRequest.find({ userId: user._id }).sort({ createdAt: -1 });
  }

  /**
   * Calculate leave forecast
   */
  async getLeaveForecast(userEmail, targetDate) {
    const user = await User.findOne({ email: userEmail });
    if (!user) throw new Error('User not found');

    const balances = await this.getLeaveBalances(userEmail);
    const target = new Date(targetDate);
    const now = new Date();

    if (target <= now) return { forecast: balances, accrualRate: {} };

    // Simple accrual logic (can be made more complex based on employment type)
    const monthsDiff = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());

    const ACCRUAL_RATES = {
      annual: 12.66,
      sick: 6.33,
      personal: 6.33
    };

    return {
      success: true,
      forecast: {
        annualLeave: parseFloat((balances.annualLeave + (monthsDiff * ACCRUAL_RATES.annual)).toFixed(2)),
        sickLeave: parseFloat((balances.sickLeave + (monthsDiff * ACCRUAL_RATES.sick)).toFixed(2)),
        personalLeave: parseFloat((balances.personalLeave + (monthsDiff * ACCRUAL_RATES.personal)).toFixed(2)),
        longServiceLeave: balances.longServiceLeave
      },
      accrualRate: ACCRUAL_RATES
    };
  }

  /**
   * Get public holidays
   */
  async getPublicHolidays(organizationId = null, year = new Date().getFullYear()) {
    const query = {
      $or: [
        { organizationId: null },
        { organizationId: organizationId }
      ],
      date: {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`)
      }
    };

    return await PublicHoliday.find(query).sort({ date: 1 });
  }

  /**
   * Update leave balance (add or subtract)
   * @param {string} userEmail 
   * @param {string} leaveType 
   * @param {number} hours (positive to add, negative to subtract)
   * @param {string} reason 
   */
  async updateLeaveBalance(userEmail, leaveType, hours, reason) {
    const user = await User.findOne({ email: userEmail });
    if (!user) throw new Error('User not found');

    // Normalize leave type
    const normalizedType = leaveType.toLowerCase().replace('leave', '').trim();

    let balance = await LeaveBalance.findOne({ userId: user._id, leaveType: normalizedType });
    if (!balance) {
      balance = new LeaveBalance({
        userId: user._id,
        userEmail: userEmail,
        leaveType: normalizedType,
        currentBalance: 0
      });
    }

    balance.currentBalance += hours;
    if (hours > 0) {
      balance.accruedHours += hours;
    } else {
      balance.usedHours += Math.abs(hours);
    }

    // Add to history if we want to track manual adjustments
    // (Optional: add a manual adjustment request/history record)

    await balance.save();
    return balance;
  }
}

module.exports = new LeaveService();
