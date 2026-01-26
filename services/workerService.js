const Shift = require('../models/Shift');
const ActiveTimer = require('../models/ActiveTimer');
const Expense = require('../models/Expense');
const LeaveBalance = require('../models/LeaveBalance');

class WorkerService {
  /**
   * Get aggregated dashboard data for a support worker
   * @param {String} userEmail - The worker's user Email
   * @param {String} organizationId - The organization ID
   */
  async getDashboardData(userEmail, organizationId) {
    try {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      const endOfDay = new Date(now.setHours(23, 59, 59, 999));

      // 1. Get Active Timer (Clock In Status)
      const activeTimer = await ActiveTimer.findOne({
        userEmail: userEmail,
        organizationId: organizationId,
        endTime: null // Assuming null endTime means running, or check logic
      }).lean();

      // 2. Get Today's Shifts
      const todayShifts = await Shift.find({
        employeeEmail: userEmail,
        organizationId: organizationId,
        startTime: { $gte: startOfDay, $lte: endOfDay },
        status: { $ne: 'cancelled' }
      }).sort({ startTime: 1 }).lean();

      // 3. Get Next Upcoming Shift (if not in today's list, or next one today)
      const nextShift = await Shift.findOne({
        employeeEmail: userEmail,
        organizationId: organizationId,
        startTime: { $gt: new Date() },
        status: { $ne: 'cancelled' }
      }).sort({ startTime: 1 }).lean();

      // 4. Get Recent Expenses (Last 3)
      const recentExpenses = await Expense.find({
        submittedBy: userEmail,
        organizationId: organizationId
      })
      .sort({ expenseDate: -1 })
      .limit(3)
      .lean();

      // 5. Get Leave Balances
      const leaveBalances = await LeaveBalance.find({
        userEmail: userEmail
      }).lean();

      return {
        activeTimer,
        todayShifts,
        nextShift,
        recentExpenses,
        leaveBalances
      };
    } catch (error) {
      throw new Error(`Error fetching worker dashboard data: ${error.message}`);
    }
  }
}

module.exports = new WorkerService();
