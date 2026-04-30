const Shift = require('../models/Shift');
const ActiveTimer = require('../models/ActiveTimer');
const Expense = require('../models/Expense');
const LeaveBalance = require('../models/LeaveBalance');
const ClientAssignment = require('../models/ClientAssignment');

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
      const { toSafeString } = require('../utils/security');
      const safeEmail = toSafeString(userEmail);
      const safeOrgId = toSafeString(organizationId);

      const activeTimer = await ActiveTimer.findOne({
        userEmail: safeEmail,
        organizationId: safeOrgId,
        endTime: null // Assuming null endTime means running, or check logic
      }).lean();

      // 2. Get Today's Shifts
      const todayShifts = await Shift.find({
        employeeEmail: safeEmail,
        organizationId: safeOrgId,
        startTime: { $gte: startOfDay, $lte: endOfDay },
        status: { $ne: 'cancelled' }
      }).sort({ startTime: 1 }).lean();

      // 3. Get Next Upcoming Shift (if not in today's list, or next one today)
      const nextShift = await Shift.findOne({
        employeeEmail: safeEmail,
        organizationId: safeOrgId,
        startTime: { $gt: new Date() },
        status: { $ne: 'cancelled' }
      }).sort({ startTime: 1 }).lean();

      // 4. Get Recent Expenses (Last 3)
      const recentExpenses = await Expense.find({
        submittedBy: safeEmail,
        organizationId: safeOrgId
      })
      .sort({ expenseDate: -1 })
      .limit(3)
      .lean();

      // 5. Get Leave Balances
      const leaveBalances = await LeaveBalance.find({
        userEmail: safeEmail
      }).lean();

      // 6. Get Past Assigned Shifts (from assignment schedules)
      const assignments = await ClientAssignment.find({
        userEmail: safeEmail,
        organizationId: safeOrgId,
        isActive: true
      }).populate('clientId', 'clientFirstName clientLastName clientEmail').lean();

      const pastAssignedShifts = this._extractPastAssignedShifts(assignments, { limit: 20 });

      return {
        activeTimer,
        todayShifts,
        nextShift,
        recentExpenses,
        leaveBalances,
        pastAssignedShifts
      };
    } catch (error) {
      throw new Error(`Error fetching worker dashboard data: ${error.message}`);
    }
  }

  async getPastAssignedShiftHistory(userEmail, organizationId, options = {}) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeEmail = toSafeString(userEmail);
      const safeOrgId = toSafeString(organizationId);

      const assignments = await ClientAssignment.find({
        userEmail: safeEmail,
        organizationId: safeOrgId,
        isActive: true
      }).populate('clientId', 'clientFirstName clientLastName clientEmail').lean();

      return this._extractPastAssignedShifts(assignments, options);
    } catch (error) {
      throw new Error(`Error fetching worker shift history: ${error.message}`);
    }
  }

  _extractPastAssignedShifts(assignments, options = {}) {
    if (!Array.isArray(assignments) || assignments.length === 0) return [];

    const now = new Date();
    const days = Number.isInteger(options.days) && options.days > 0 ? options.days : null;
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 20;
    const startBoundary = days != null
      ? new Date(now.getTime() - (days * 24 * 60 * 60 * 1000))
      : null;
    const history = [];

    for (const assignment of assignments) {
      if (!Array.isArray(assignment.schedule) || assignment.schedule.length === 0) {
        continue;
      }

      const clientName = this._resolveClientName(assignment);
      const clientEmail = assignment.clientEmail || assignment.clientId?.clientEmail || null;

      for (let i = 0; i < assignment.schedule.length; i += 1) {
        const scheduleItem = assignment.schedule[i];

        if (!scheduleItem?.date || !scheduleItem?.startTime || !scheduleItem?.endTime) {
          continue;
        }

        const startTime = this._combineDateAndTime(scheduleItem.date, scheduleItem.startTime);
        const endTime = this._combineDateAndTime(scheduleItem.date, scheduleItem.endTime);
        if (!startTime || !endTime) continue;

        const normalizedEndTime = endTime < startTime
          ? new Date(endTime.getTime() + (24 * 60 * 60 * 1000))
          : endTime;

        if (normalizedEndTime > now) continue;
        if (startBoundary && normalizedEndTime < startBoundary) continue;

        history.push({
          id: `${assignment._id?.toString() || 'assignment'}_${scheduleItem._id?.toString() || i}`,
          employeeEmail: assignment.userEmail,
          clientId: assignment.clientId?._id?.toString?.() || assignment.clientId?.toString?.() || null,
          clientEmail,
          clientName,
          organizationId: assignment.organizationId,
          startTime: startTime.toISOString(),
          endTime: normalizedEndTime.toISOString(),
          status: 'completed',
          breakDuration: this._parseBreakDuration(scheduleItem.break),
          supportItems: this._toSupportItems(scheduleItem.ndisItem),
          notes: null,
          isRecurring: false,
          createdAt: assignment.createdAt || null,
          updatedAt: assignment.updatedAt || null
        });
      }
    }

    history.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    return history.slice(0, limit);
  }

  _resolveClientName(assignment) {
    const first = assignment?.clientId?.clientFirstName;
    const last = assignment?.clientId?.clientLastName;
    const full = `${first || ''} ${last || ''}`.trim();
    if (full) return full;
    return assignment?.clientEmail || assignment?.clientId?.clientEmail || 'Unknown Client';
  }

  _combineDateAndTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const parsedTime = this._parseTimeToHoursAndMinutes(timeStr);
    if (!parsedTime) return null;

    const [year, month, day] = String(dateStr).split('-').map((part) => Number(part));
    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day, parsedTime.hours, parsedTime.minutes, 0, 0);
  }

  _parseTimeToHoursAndMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const normalized = timeStr.trim();
    if (!normalized) return null;

    const twelveHourMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([aApP][mM])$/);
    if (twelveHourMatch) {
      let hours = Number(twelveHourMatch[1]);
      const minutes = Number(twelveHourMatch[2]);
      const period = twelveHourMatch[3].toUpperCase();
      if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
        return null;
      }
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return { hours, minutes };
    }

    const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourHourMatch) {
      const hours = Number(twentyFourHourMatch[1]);
      const minutes = Number(twentyFourHourMatch[2]);
      if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
      }
      return { hours, minutes };
    }

    return null;
  }

  _parseBreakDuration(breakValue) {
    if (breakValue == null) return 0;
    if (typeof breakValue === 'number') return breakValue >= 0 ? breakValue : 0;

    const text = String(breakValue).trim();
    if (!text || text.toLowerCase() === 'no') return 0;

    const numeric = Number(text);
    if (!Number.isNaN(numeric) && numeric >= 0) return numeric;

    const mins = text.match(/(\d+)\s*min/i);
    if (mins) return Number(mins[1]) || 0;

    const hours = text.match(/(\d+(?:\.\d+)?)\s*hour/i);
    if (hours) {
      const parsedHours = Number(hours[1]);
      if (Number.isNaN(parsedHours) || parsedHours < 0) return 0;
      return Math.round(parsedHours * 60);
    }

    return 0;
  }

  _toSupportItems(ndisItem) {
    if (!ndisItem || typeof ndisItem !== 'object') return [];
    return [{
      itemNumber: ndisItem.itemNumber || '',
      itemName: ndisItem.itemName || '',
      unit: ndisItem.unit || null,
      supportCategoryNumber: ndisItem.supportCategoryNumber || null,
      supportCategoryName: ndisItem.supportCategoryName || null
    }];
  }
}

module.exports = new WorkerService();
