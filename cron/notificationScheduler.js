const cron = require('node-cron');
const NotificationService = require('../services/notificationService');
const NotificationSetting = require('../models/NotificationSetting');
const NotificationHistory = require('../models/NotificationHistory');
const Shift = require('../models/Shift');
const Expense = require('../models/Expense');
const User = require('../models/User');
const logger = require('../utils/logger').createLogger('NotificationScheduler');
const QueueManager = require('../core/QueueManager');
const { QUEUE_NAME } = require('../workers/notificationWorker');

class NotificationScheduler {
  start() {
    logger.info('Starting Notification Scheduler...');

    // Shift Reminders: Run every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      await this.processShiftReminders();
    });

    // Expense Reminders: Run every hour
    cron.schedule('0 * * * *', async () => {
      await this.processExpenseReminders();
    });

    // Timesheet Reminders: Run every day at 6 PM
    cron.schedule('0 18 * * *', async () => {
      await this.processTimesheetReminders();
    });
  }

  async processShiftReminders() {
    try {
      logger.info('Processing shift reminders...');
      const now = new Date();
      const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Find shifts starting in the next 24 hours
      const shifts = await Shift.find({
        startTime: { $gte: now, $lte: next24Hours },
        status: 'published'
      }).lean();

      for (const shift of shifts) {
        // userId might be stored as employeeId in Shift model
        const userId = shift.employeeId || shift.userId;
        if (!userId) continue;

        const settings = await NotificationService.getSettings(userId);
        if (!settings || !settings.shiftReminders.enabled) continue;

        const timeUntilShift = (new Date(shift.startTime) - now) / (1000 * 60 * 60); // in hours

        for (const timing of settings.shiftReminders.timings) {
          // Check if we are within the window for this reminder (e.g. +/- 7.5 mins)
          if (Math.abs(timeUntilShift - timing) < 0.25) { 
            // Check if already sent
            const alreadySent = await NotificationHistory.findOne({
              userId: userId,
              type: 'shift',
              'data.shiftId': shift._id,
              'data.timing': timing
            });

            if (!alreadySent) {
              await this.sendNotification(userId, {
                type: 'shift',
                title: 'Upcoming Shift Reminder',
                body: `You have a shift starting in ${timing} hour(s).`,
                data: { shiftId: shift._id, timing }
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error processing shift reminders', { error: error.message });
    }
  }

  async processExpenseReminders() {
    try {
      logger.info('Processing expense reminders...');
      
      // Find expenses without receipts created > 24 hours ago (simplified)
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const pendingExpenses = await Expense.find({
        receiptUrl: null,
        createdAt: { $lte: oneDayAgo },
        status: { $ne: 'cancelled' }
      }).lean();

      for (const expense of pendingExpenses) {
        // Get user from expense (submittedBy is email, need userId)
        const user = await User.findOne({ email: expense.submittedBy }).lean();
        if (!user) continue;

        const settings = await NotificationService.getSettings(user._id);
        if (!settings || !settings.expenseReminders.enabled) continue;

        // Check frequency/deadline logic here
        // For now, just send one reminder if not sent today
        const alreadySentToday = await NotificationHistory.findOne({
          userId: user._id,
          type: 'expense',
          'data.expenseId': expense._id,
          createdAt: { $gte: new Date(now.setHours(0,0,0,0)) }
        });

        if (!alreadySentToday) {
           await this.sendNotification(user._id, {
            type: 'expense',
            title: 'Expense Receipt Missing',
            body: `Please upload a receipt for your expense of $${expense.amount}.`,
            data: { expenseId: expense._id }
          });
        }
      }
    } catch (error) {
      logger.error('Error processing expense reminders', { error: error.message });
    }
  }

  async processTimesheetReminders() {
    // Similar logic to expense reminders, but for timesheets
    // Simplified for this implementation
    logger.info('Processing timesheet reminders... (Placeholder)');
  }

  async sendNotification(userId, notification) {
    // Create history record (status: scheduled)
    const history = await NotificationHistory.create({
      userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      status: 'scheduled',
      scheduledAt: new Date(),
      sentAt: null // Will be updated by worker
    });

    // Add to queue
    await QueueManager.addJob(QUEUE_NAME, 'send-notification', {
      userId,
      notification,
      historyId: history._id
    });
    
    logger.info(`Notification scheduled for user ${userId}: ${notification.title}`);
  }
}

module.exports = new NotificationScheduler();
