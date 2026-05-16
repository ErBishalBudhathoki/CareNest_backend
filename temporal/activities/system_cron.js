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
 *
 * Fixes applied vs original:
 * 1. Tags are now deleted BEFORE we attempt to delete any version, and failures
 *    are treated as hard blockers (the version is skipped, not attempted).
 * 2. Versions that still carry protected tags are excluded up-front.
 * 3. Multi-pass deletion handles parent/child manifest ordering automatically:
 *    Pass 1 – delete everything we can (parent manifest-lists, which just had
 *              their tags stripped, go first).
 *    Pass 2+ – retry the ones that failed because a parent hadn't been removed
 *              yet.  Repeats until no more progress is made (max 5 passes).
 */
async function cleanupArtifactRegistryActivity() {
  const credentials =
    process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL
      ? {
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }
      : undefined;

  const projectId = process.env.FIREBASE_PROJECT_ID || 'invoice-660f3';
  const isProd =
    projectId === 'carenest-prods' || process.env.NODE_ENV === 'production';

  const env = {
    name: isProd ? 'Production' : 'Development',
    project: projectId,
    package: isProd ? 'backend-prod' : 'backend-dev',
    keepCount: isProd ? 20 : 10,
  };

  const PROTECTED_TAGS = new Set([
    'latest', 'prod', 'production', 'dev', 'development', 'main', 'master',
  ]);

  logger.info(
    `[Temporal Activity] Starting Artifact Registry cleanup for ${env.name} (${env.project})…`
  );

  try {
    const client = new ArtifactRegistryClient({
      projectId: env.project,
      ...(credentials && { credentials }),
    });

    const region = 'australia-southeast1';
    const repo = 'backend-repo';
    const parent = `projects/${env.project}/locations/${region}/repositories/${repo}/packages/${env.package}`;

    const [versions] = await client.listVersions({ parent });

    if (!versions?.length) {
      logger.info('[Temporal Activity] No versions found – nothing to clean.');
      return { success: true, message: 'No versions found.' };
    }

    // ── Sort newest → oldest ──────────────────────────────────────────────────
    const sorted = [...versions].sort((a, b) => {
      const tA = (Number(a.createTime?.seconds) || 0) * 1e3 + (Number(a.createTime?.nanos) || 0) / 1e6;
      const tB = (Number(b.createTime?.seconds) || 0) * 1e3 + (Number(b.createTime?.nanos) || 0) / 1e6;
      return tB - tA; // newest first
    });

    const candidates = sorted.slice(env.keepCount);

    logger.info(
      `[Temporal Activity] ${sorted.length} total versions. Keeping ${env.keepCount}, ` +
      `evaluating ${candidates.length} for deletion.`
    );

    // ── Helper: resolve a tag object → its full resource name ─────────────────
    const fullTagName = (tag, versionName) => {
      if (typeof tag === 'string') {
        const packagePath = versionName.split('/versions/')[0];
        return `${packagePath}/tags/${tag}`;
      }
      return tag.name;
    };

    const tagShortName = (tag) =>
      typeof tag === 'string' ? tag : (tag.name || '').split('/').pop();

    // ── PHASE 1: filter out anything with a protected tag ────────────────────
    const toDelete = [];
    const skippedProtected = [];

    for (const version of candidates) {
      const tags = version.relatedTags || [];
      const hasProtected = tags.some((t) => PROTECTED_TAGS.has(tagShortName(t)));
      if (hasProtected) {
        skippedProtected.push(version.name.split('/').pop());
        logger.info(
          `[Temporal Activity] Skipping ${version.name.split('/').pop()} – has protected tag.`
        );
      } else {
        toDelete.push(version);
      }
    }

    // ── PHASE 2: explicitly list & delete ALL tags, then mark safe to delete ──────
    // listVersions does NOT populate relatedTags reliably. We must call listTags
    // directly, filtered to each version we intend to remove.

    const packagePath = parent; // same parent used for listVersions
    const [allTags] = await client.listTags({ parent: packagePath });

    // Build a map: versionName → [tag resource names]
    const tagsByVersion = new Map();
    for (const tag of allTags) {
      // tag.version is the full version resource name e.g. .../versions/sha256:abc
      const ver = tag.version || '';
      if (!tagsByVersion.has(ver)) tagsByVersion.set(ver, []);
      tagsByVersion.get(ver).push(tag.name); // tag.name is already the full resource path
    }

    logger.info(
      `[Temporal Activity] Found ${allTags.length} total tags across all versions.`
    );

    const safeToDelete = [];

    for (const version of toDelete) {
      const tags = tagsByVersion.get(version.name) || [];

      if (tags.length === 0) {
        // No tags at all — safe to attempt deletion directly
        safeToDelete.push(version);
        continue;
      }

      let tagError = false;
      for (const tagResourceName of tags) {
        const short = tagResourceName.split('/').pop();
        
        // Critical check: If it has a protected tag, we MUST skip the entire version
        if (PROTECTED_TAGS.has(short)) {
          logger.info(`[Temporal Activity] Skipping version ${version.name.split('/').pop()} as it has protected tag: ${short}`);
          tagError = true;
          break;
        }

        try {
          await client.deleteTag({ name: tagResourceName });
          logger.info(`[Temporal Activity] Deleted tag "${short}" from ${version.name.split('/').pop()}`);
        } catch (err) {
          logger.error(
            `[Temporal Activity] Could not delete tag "${short}" from ` +
            `${version.name.split('/').pop()} — skipping this version. Reason: ${err.message}`
          );
          tagError = true;
          break;
        }
      }

      if (!tagError) {
        safeToDelete.push(version);
      }
    }

    // ── PHASE 3: multi-pass version deletion (handles parent→child ordering) ──
    let remaining = [...safeToDelete];
    let deletedCount = 0;
    let failedCount = 0;
    const MAX_PASSES = 5;

    for (let pass = 1; pass <= MAX_PASSES && remaining.length > 0; pass++) {
      logger.info(
        `[Temporal Activity] Deletion pass ${pass}/${MAX_PASSES} – ${remaining.length} version(s) remaining…`
      );

      const stillFailed = [];

      for (const version of remaining) {
        try {
          const { Context } = require('@temporalio/activity');
          Context.current().heartbeat(`Pass ${pass} – deleted ${deletedCount} so far`);
        } catch (_) { /* ignore outside worker context */ }

        try {
          const [operation] = await client.deleteVersion({ name: version.name });
          await operation.promise();
          deletedCount++;
          logger.info(`[Temporal Activity] Deleted ${version.name.split('/').pop()}`);
        } catch (err) {
          stillFailed.push(version);
          if (pass === MAX_PASSES) {
            failedCount++;
            logger.error(
              `[Temporal Activity] Permanently failed to delete ` +
              `${version.name.split('/').pop()}: ${err.message}`
            );
          } else {
            logger.warn(
              `[Temporal Activity] Pass ${pass} – will retry ` +
              `${version.name.split('/').pop()}: ${err.message}`
            );
          }
        }
      }

      const madeProgress = stillFailed.length < remaining.length;
      remaining = stillFailed;

      if (!madeProgress) {
        logger.warn(`[Temporal Activity] No progress on pass ${pass} – stopping early.`);
        failedCount += remaining.length;
        break;
      }
    }

    const result = {
      env: env.name,
      total: sorted.length,
      kept: env.keepCount,
      skippedProtected: skippedProtected.length,
      deleted: deletedCount,
      failed: failedCount,
    };

    logger.info('[Temporal Activity] Artifact Registry cleanup complete', result);
    return result;

  } catch (error) {
    logger.error(
      `[Temporal Activity] Artifact Registry cleanup failed for ${env.name}`,
      error
    );
    return { env: env.name, status: 'failed', error: error.message };
  }
}

module.exports = {
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity,
  cleanupArtifactRegistryActivity
};

