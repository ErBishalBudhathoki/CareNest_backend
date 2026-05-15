const logger = require('../../config/logger');

// Services
const dunningService = require('../../services/dunningService');
const { processAllExpenseReminders } = require('../../services/expenseReminderService');
const { processAllTimesheetReminders } = require('../../services/timesheetReminderService');
const NotificationService = require('../../services/notificationService');

// Models
const NotificationHistory = require('../../models/NotificationHistory');
const Shift = require('../../models/Shift');
const Expense = require('../../models/Expense');
const User = require('../../models/User');
const FcmToken = require('../../models/FcmToken');
const { admin, messaging } = require('../../firebase-admin-config');

/**
 * Trigger Temporal Workflow (replaces the one in notificationScheduler)
 */
async function triggerNotificationWorkflow(userId, notification) {
  // We can't easily require TemporalManager from inside an activity due to complex deps,
  // but we can just use the Temporal Client directly or emit the logic.
  // Actually, wait, triggering a workflow from an activity is an anti-pattern.
  // But for now, we will just use TemporalManager to start it to keep the code equivalent.
  try {
    const temporalClient = await require('../../core/TemporalManager').getClient();
    const history = await NotificationHistory.create({
      userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      status: 'scheduled',
      scheduledAt: new Date(),
      sentAt: null
    });

    await temporalClient.workflow.start('NotificationWorkflow', {
      taskQueue: 'default',
      workflowId: `notification-${history._id}`,
      args: [{
        userId,
        notification,
        historyId: history._id.toString()
      }]
    });
    logger.info(`Notification workflow started for user ${userId}: ${notification.title}`);
  } catch (error) {
    logger.error(`Failed to trigger notification workflow for user ${userId}`, error);
  }
}

/**
 * Activity: Dunning Process
 */
async function processDunningActivity() {
  logger.info('[Temporal Activity] Starting daily dunning process...');
  try {
    const result = await dunningService.processOverdueInvoices();
    logger.info('[Temporal Activity] Daily dunning process completed', result);
    return result;
  } catch (error) {
    logger.error('[Temporal Activity] Daily dunning process failed', error);
    throw error;
  }
}

/**
 * Activity: Expense Reminders
 */
async function processExpenseRemindersActivity() {
  logger.info('[Temporal Activity] Starting expense reminders process...');
  try {
    const result = await processAllExpenseReminders();
    logger.info('[Temporal Activity] Expense reminders process completed', result);
    return result;
  } catch (error) {
    logger.error('[Temporal Activity] Expense reminders process failed', error);
    throw error;
  }
}

/**
 * Activity: Timesheet Reminders
 */
async function processTimesheetRemindersActivity() {
  logger.info('[Temporal Activity] Starting timesheet reminders process...');
  try {
    // processAllTimesheetReminders handles the hourly check of organization settings internally
    const result = await processAllTimesheetReminders();
    logger.info('[Temporal Activity] Timesheet reminders process completed', result);
    return result;
  } catch (error) {
    logger.error('[Temporal Activity] Timesheet reminders process failed', error);
    throw error;
  }
}

/**
 * Activity: Shift Reminders
 */
async function processShiftRemindersActivity() {
  logger.info('[Temporal Activity] Processing shift reminders...');
  try {
    const now = new Date();
    const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const shifts = await Shift.find({
      startTime: { $gte: now, $lte: next24Hours },
      status: 'published'
    }).lean();

    let processedCount = 0;
    for (const shift of shifts) {
      const userId = shift.employeeId || shift.userId;
      if (!userId) continue;

      const settings = await NotificationService.getSettings(userId);
      if (!settings || !settings.shiftReminders.enabled) continue;

      const timeUntilShift = (new Date(shift.startTime) - now) / (1000 * 60 * 60);

      for (const timing of settings.shiftReminders.timings) {
        if (Math.abs(timeUntilShift - timing) < 0.25) {
          const alreadySent = await NotificationHistory.findOne({
            userId: userId,
            type: 'shift',
            'data.shiftId': shift._id,
            'data.timing': timing
          });

          if (!alreadySent) {
            await triggerNotificationWorkflow(userId, {
              type: 'shift',
              title: 'Upcoming Shift Reminder',
              body: `You have a shift starting in ${timing} hour(s).`,
              data: { shiftId: shift._id, timing }
            });
            processedCount++;
          }
        }
      }
    }
    return { processed: processedCount, scanned: shifts.length };
  } catch (error) {
    logger.error('[Temporal Activity] Error processing shift reminders', { error: error.message });
    throw error;
  }
}

/**
 * Activity: Email Verification Reminders
 */
async function processEmailVerificationRemindersActivity() {
  logger.info('[Temporal Activity] Processing email verification reminders...');
  try {
    const unverifiedUsers = await User.find({
      isActive: { $ne: false },
      email: { $exists: true, $ne: null },
      emailVerified: { $ne: true }
    }).select('_id email firstName firebaseUid').lean();

    if (!unverifiedUsers.length) {
      logger.info('[Temporal Activity] No unverified users found for email verification reminders');
      return { sentCount: 0 };
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let sentCount = 0;
    let skippedNoToken = 0;
    let alreadySentCount = 0;
    let failedCount = 0;
    const canCheckFirebaseStatus = Array.isArray(admin.apps) && admin.apps.length > 0;

    for (const user of unverifiedUsers) {
      const normalizedEmail = String(user.email || '').trim().toLowerCase();
      if (!normalizedEmail) continue;

      if (canCheckFirebaseStatus && user.firebaseUid) {
        try {
          const firebaseUser = await admin.auth().getUser(user.firebaseUid);
          if (firebaseUser.emailVerified) {
            await User.updateOne({ _id: user._id }, { $set: { emailVerified: true, updatedAt: new Date() } });
            continue;
          }
        } catch (firebaseLookupError) {
          logger.warn('Failed to re-check Firebase verification status', {
            userId: user._id?.toString(),
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
        alreadySentCount++;
        continue;
      }

      const tokenDoc = await FcmToken.findOne({ userEmail: normalizedEmail }).lean();
      if (!tokenDoc?.fcmToken) {
        skippedNoToken++;
        continue;
      }

      const history = await NotificationHistory.create({
        userId: user._id,
        type: 'email_verification',
        title: 'Verify your email',
        body: 'Please verify your email address in Settings to keep your account secure.',
        data: { channel: 'verify_email', screen: 'settings', action: 'verify_email' },
        status: 'scheduled',
        scheduledAt: now
      });

      try {
        const response = await messaging.send({
          token: tokenDoc.fcmToken,
          notification: { title: 'Verify your email', body: 'Please verify your email address in Settings to keep your account secure.' },
          data: { type: 'email_verification', channel: 'verify_email', action: 'open_settings', screen: 'settings' },
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } }
        });

        const messageId = typeof response === 'string' ? response.split('/').pop() : null;
        await NotificationHistory.findByIdAndUpdate(history._id, {
          status: 'delivered',
          sentAt: new Date(),
          deliveredAt: new Date(),
          ...(messageId ? { fcmMessageId: messageId } : {})
        });
        sentCount++;
      } catch (error) {
        failedCount++;
        await NotificationHistory.findByIdAndUpdate(history._id, {
          status: 'failed',
          sentAt: new Date(),
          error: error.message
        });

        if (error.code === 'messaging/registration-token-not-registered' || error.code === 'messaging/invalid-argument') {
          await FcmToken.deleteOne({ userEmail: normalizedEmail });
        }
      }
    }

    return { totalUnverifiedUsers: unverifiedUsers.length, sentCount, alreadySentCount, skippedNoToken, failedCount };
  } catch (error) {
    logger.error('[Temporal Activity] Error processing email verification reminders', { error: error.message });
    throw error;
  }
}

module.exports = {
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity
};
