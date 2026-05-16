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
const { ArtifactRegistryClient } = require('@google-cloud/artifact-registry');

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

/**
 * Activity: Cleanup Artifact Registry
 */
async function cleanupArtifactRegistryActivity() {
  // Extract credentials from environment if available (needed for Oracle server hosting)
  const credentials = process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL ? {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  } : undefined;

  // Determine which environment to clean based on current deployment
  const projectId = process.env.FIREBASE_PROJECT_ID || 'invoice-660f3';
  const isProd = projectId === 'carenest-prods' || process.env.NODE_ENV === 'production';

  const env = {
    name: isProd ? 'Production' : 'Development',
    project: projectId,
    package: isProd ? 'backend-prod' : 'backend-dev',
    keepCount: isProd ? 20 : 10
  };

  const results = [];

  logger.info(`[Temporal Activity] Starting Artifact Registry cleanup for ${env.name} (${env.project})...`);
  try {
    // Initialize client per environment/project to ensure correct project context
    const client = new ArtifactRegistryClient({
      projectId: env.project,
      ...(credentials && { credentials })
    });

    const region = 'australia-southeast1';
    const repo = 'backend-repo';
    const parent = `projects/${env.project}/locations/${region}/repositories/${repo}/packages/${env.package}`;

    // List all versions
    const [versions] = await client.listVersions({ parent });

    if (!versions || versions.length === 0) {
      results.push({ env: env.name, status: 'no_images' });
      return { success: true, message: "No versions found or repository missing." };
    }

    // Sort by createTime descending (newest first)
    const sortedVersions = versions.sort((a, b) => {
      if (!a.createTime || !b.createTime) return 0;
      const timeA = (Number(a.createTime.seconds) || 0) * 1000 + ((Number(a.createTime.nanos) || 0) / 1000000);
      const timeB = (Number(b.createTime.seconds) || 0) * 1000 + ((Number(b.createTime.nanos) || 0) / 1000000);
      return timeB - timeA;
    });

    const total = sortedVersions.length;
    const toDelete = sortedVersions.slice(env.keepCount);

    logger.info(`[Temporal Activity] Found ${total} versions for ${env.name}. Keeping ${env.keepCount}, deleting ${toDelete.length}...`);

    let deletedCount = 0;
    let failedCount = 0;

    for (const version of toDelete) {
      // Send heartbeat to Temporal to prevent timeout during long cleanups
      try {
        const { Context } = require('@temporalio/activity');
        Context.current().heartbeat(`Cleaning up ${env.name}: ${deletedCount}/${toDelete.length}`);
      } catch (e) {
        // Ignore if not running in a worker context (e.g. tests)
      }

      // Safety check: Never delete a version that has tags (e.g., 'latest' or a version tag)
      if (version.relatedTags && version.relatedTags.length > 0) {
        const tagNames = version.relatedTags.map(t => typeof t === 'string' ? t : (t.name || 'unknown')).join(', ');
        logger.info(`[Temporal Activity] Skipping version ${version.name} as it has tags: ${tagNames}`);
        continue;
      }

      try {
        await client.deleteVersion({ name: version.name });
        deletedCount++;
      } catch (err) {
        logger.error(`[Temporal Activity] Failed to delete version ${version.name}`, err);
        failedCount++;
      }
    }

    results.push({
      env: env.name,
      total,
      deleted: deletedCount,
      failed: failedCount,
      kept: total - deletedCount
    });

  } catch (error) {
    logger.error(`[Temporal Activity] Artifact Registry cleanup failed for ${env.name}`, error);
    results.push({ env: env.name, status: 'failed', error: error.message });
  }

  return results;
}

module.exports = {
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity,
  cleanupArtifactRegistryActivity
};
