const cron = require('node-cron');
const NotificationService = require('../services/notificationService');
const NotificationHistory = require('../models/NotificationHistory');
const Shift = require('../models/Shift');
const Expense = require('../models/Expense');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');
const logger = require('../config/logger');
const QueueManager = require('../core/QueueManager');
const { QUEUE_NAME } = require('../workers/notificationWorker');
const { admin, messaging } = require('../firebase-admin-config');

class NotificationScheduler {
  start() {
    // Skip cron jobs in production Cloud Functions environment
    // Use Google Cloud Scheduler to trigger HTTP endpoints instead for production
    const isProductionServerless = process.env.NODE_ENV === 'production' &&
      (process.env.FUNCTIONS_EMULATOR === 'true' ||
        process.env.K_SERVICE ||  // Cloud Run/Functions indicator
        process.env.FUNCTION_TARGET);  // Cloud Functions indicator

    if (isProductionServerless) {
      logger.info('Skipping in-process cron scheduler in production Cloud Functions - use Cloud Scheduler instead');
      return;
    }

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

    // Email Verification Reminders: Run once daily at 10 AM (Australia/Sydney)
    cron.schedule(
      '0 10 * * *',
      async () => {
        await this.processEmailVerificationReminders();
      },
      { timezone: 'Australia/Sydney' }
    );
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
          createdAt: { $gte: new Date(now.setHours(0, 0, 0, 0)) }
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

  async processEmailVerificationReminders() {
    try {
      logger.info('Processing email verification reminders...');

      const unverifiedUsers = await User.find({
        isActive: { $ne: false },
        email: { $exists: true, $ne: null },
        emailVerified: { $ne: true }
      })
        .select('_id email firstName firebaseUid')
        .lean();

      if (!unverifiedUsers.length) {
        logger.info('No unverified users found for email verification reminders');
        return;
      }

      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      let sentCount = 0;
      let skippedNoToken = 0;
      let alreadySentCount = 0;
      let failedCount = 0;
      const canCheckFirebaseStatus =
        Array.isArray(admin.apps) && admin.apps.length > 0;

      for (const user of unverifiedUsers) {
        const normalizedEmail = String(user.email || '').trim().toLowerCase();
        if (!normalizedEmail) {
          continue;
        }

        // Re-check verification directly in Firebase to avoid stale reminders.
        if (canCheckFirebaseStatus && user.firebaseUid) {
          try {
            const firebaseUser = await admin.auth().getUser(user.firebaseUid);
            if (firebaseUser.emailVerified) {
              await User.updateOne(
                { _id: user._id },
                { $set: { emailVerified: true, updatedAt: new Date() } }
              );
              continue;
            }
          } catch (firebaseLookupError) {
            logger.warn('Failed to re-check Firebase verification status', {
              userId: user._id?.toString(),
              firebaseUid: user.firebaseUid,
              error: firebaseLookupError.message
            });
          }
        }

        const alreadySent = await NotificationHistory.findOne({
          userId: user._id,
          type: 'email_verification',
          createdAt: { $gte: twentyFourHoursAgo }
        }).lean();

        if (alreadySent) {
          alreadySentCount += 1;
          continue;
        }

        const tokenDoc = await FcmToken.findOne({
          userEmail: normalizedEmail
        }).lean();

        if (!tokenDoc?.fcmToken) {
          skippedNoToken += 1;
          continue;
        }

        const history = await NotificationHistory.create({
          userId: user._id,
          type: 'email_verification',
          title: 'Verify your email',
          body:
            'Please verify your email address in Settings to keep your account secure.',
          data: {
            channel: 'verify_email',
            screen: 'settings',
            action: 'verify_email'
          },
          status: 'scheduled',
          scheduledAt: now
        });

        try {
          const response = await messaging.send({
            token: tokenDoc.fcmToken,
            notification: {
              title: 'Verify your email',
              body:
                'Please verify your email address in Settings to keep your account secure.'
            },
            data: {
              type: 'email_verification',
              channel: 'verify_email',
              action: 'open_settings',
              screen: 'settings'
            },
            android: { priority: 'high' },
            apns: { headers: { 'apns-priority': '10' } }
          });

          const messageId =
            typeof response === 'string' ? response.split('/').pop() : null;

          await NotificationHistory.findByIdAndUpdate(history._id, {
            status: 'delivered',
            sentAt: new Date(),
            deliveredAt: new Date(),
            ...(messageId ? { fcmMessageId: messageId } : {})
          });
          sentCount += 1;
        } catch (error) {
          failedCount += 1;
          await NotificationHistory.findByIdAndUpdate(history._id, {
            status: 'failed',
            sentAt: new Date(),
            error: error.message
          });

          if (
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-argument'
          ) {
            await FcmToken.deleteOne({ userEmail: normalizedEmail });
          }
        }
      }

      logger.info('Email verification reminder processing complete', {
        totalUnverifiedUsers: unverifiedUsers.length,
        sentCount,
        alreadySentCount,
        skippedNoToken,
        failedCount
      });
    } catch (error) {
      logger.error('Error processing email verification reminders', {
        error: error.message
      });
    }
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

const notificationSchedulerInstance = new NotificationScheduler();

// Export instance and individual methods for Cloud Scheduler
module.exports = notificationSchedulerInstance;
module.exports.processShiftReminders = notificationSchedulerInstance.processShiftReminders.bind(notificationSchedulerInstance);
module.exports.processExpenseReminders = notificationSchedulerInstance.processExpenseReminders.bind(notificationSchedulerInstance);
module.exports.processTimesheetReminders = notificationSchedulerInstance.processTimesheetReminders.bind(notificationSchedulerInstance);
module.exports.processEmailVerificationReminders = notificationSchedulerInstance.processEmailVerificationReminders.bind(notificationSchedulerInstance);
