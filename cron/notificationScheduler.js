const cron = require('node-cron');
const NotificationService = require('../services/notificationService');
const NotificationSetting = require('../models/NotificationSetting');
const NotificationHistory = require('../models/NotificationHistory');
const Shift = require('../models/Shift'); // Assuming this exists
const logger = require('../utils/logger').createLogger('NotificationScheduler');
const { MongoClient } = require('mongodb');
const QueueManager = require('../core/QueueManager');
const { QUEUE_NAME } = require('../workers/notificationWorker');

// Helper to get raw db connection for legacy collections
async function getDb() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return { client, db: client.db(process.env.DB_NAME || 'Invoice') };
}

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
      // Using Shift model if it works, or raw query
      const shifts = await Shift.find({
        startTime: { $gte: now, $lte: next24Hours },
        status: 'published' // Assuming status field
      }).lean();

      for (const shift of shifts) {
        const settings = await NotificationService.getSettings(shift.userId);
        if (!settings || !settings.shiftReminders.enabled) continue;

        const timeUntilShift = (new Date(shift.startTime) - now) / (1000 * 60 * 60); // in hours

        for (const timing of settings.shiftReminders.timings) {
          // Check if we are within the window for this reminder (e.g. +/- 7.5 mins)
          if (Math.abs(timeUntilShift - timing) < 0.25) { 
            // Check if already sent
            const alreadySent = await NotificationHistory.findOne({
              userId: shift.userId,
              type: 'shift',
              'data.shiftId': shift._id,
              'data.timing': timing
            });

            if (!alreadySent) {
              await this.sendNotification(shift.userId, {
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
    let client, db;
    try {
      logger.info('Processing expense reminders...');
      ({ client, db } = await getDb());
      
      // Find expenses without receipts created > 24 hours ago (simplified)
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const pendingExpenses = await db.collection('expenses').find({
        receiptUrl: null,
        createdAt: { $lte: oneDayAgo },
        status: { $ne: 'cancelled' }
      }).toArray();

      for (const expense of pendingExpenses) {
        // Get user from expense (submittedBy is email, need userId)
        const user = await db.collection('users').findOne({ email: expense.submittedBy });
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
    } finally {
      if (client) await client.close();
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
