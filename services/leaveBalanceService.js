const LeaveBalance = require('../models/LeaveBalance');
const User = require('../models/User');

class LeaveBalanceService {
  /**
   * Get leave balances for a user. Initializes if not exists.
   * @param {string} userEmail 
   * @returns {Promise<Object>} Map of leave types to balances
   */
  async getBalances(userEmail) {
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
        currentBalance: 0, // Default start balance
        accruedHours: 0,
        usedHours: 0
      }));

      if (newBalances.length > 0) {
        await LeaveBalance.insertMany(newBalances);
        balances = await LeaveBalance.find({ userId: user._id });
      }
    }

    // Transform to friendly format
    const balanceMap = {};
    balances.forEach(b => {
      balanceMap[b.leaveType] = b.currentBalance;
    });

    // Ensure all keys exist
    leaveTypes.forEach(type => {
      if (balanceMap[type] === undefined) balanceMap[type] = 0;
    });

    // Handle mapping 'personal' to 'personalLeave' for frontend if needed, 
    // but better to keep consistency. 
    // The PRD mentions 'annual', 'sick', 'personal', 'longService'.
    // The frontend view expects keys like 'annualLeave', 'personalLeave'.
    // I will map them here to match frontend expectation or update frontend.
    // Let's return standardized keys.
    return {
      annualLeave: balanceMap['annual'] || 0,
      sickLeave: balanceMap['sick'] || 0,
      personalLeave: balanceMap['personal'] || 0,
      longServiceLeave: balanceMap['longService'] || 0
    };
  }

  /**
   * Update leave balance (add or subtract)
   * @param {string} userEmail 
   * @param {string} leaveType 
   * @param {number} hours (positive to add, negative to subtract)
   * @param {string} reason 
   */
  async updateBalance(userEmail, leaveType, hours, _reason) {
    // Log the reason for update (audit trail would be better, but logging is a start)
    // console.log(`Updating balance for ${userEmail} (${leaveType}): ${hours} hours. Reason: ${reason}`);
    
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      throw new Error('User not found');
    }

    // Normalize leave type
    const normalizedType = leaveType.replace('Leave', ''); // annualLeave -> annual
    
    let balance = await LeaveBalance.findOne({ userId: user._id, leaveType: normalizedType });
    if (!balance) {
      // Create if not exists
      balance = new LeaveBalance({
        userId: user._id,
        userEmail: userEmail,
        leaveType: normalizedType,
        currentBalance: 0
      });
    }

    // Check for sufficient balance if deducting
    if (hours < 0 && (balance.currentBalance + hours < 0)) {
      // Allow negative balance? Usually no, unless configured. 
      // For now, throw error.
      throw new Error(`Insufficient ${leaveType} balance.`);
    }

    balance.currentBalance += hours;
    if (hours > 0) {
      balance.accruedHours += hours;
    } else {
      balance.usedHours += Math.abs(hours);
    }
    
    await balance.save();

    return balance;
  }

  /**
   * Check if user has enough balance
   * @param {string} userEmail 
   * @param {string} leaveType 
   * @param {number} hours 
   */
  async checkBalance(userEmail, leaveType, hours) {
    const balances = await this.getBalances(userEmail);
    // Map leaveType to key
    let key = leaveType;
    if (!key.endsWith('Leave') && key !== 'longService') key += 'Leave';
    if (key === 'longService') key = 'longServiceLeave';

    const current = balances[key] || 0;
    return current >= hours;
  }
}

module.exports = new LeaveBalanceService();
