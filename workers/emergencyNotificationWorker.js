/**
 * Emergency Notification Worker
 *
 * Processes `emergency_alert` jobs from the `notifications` BullMQ queue.
 * Each job contains { userId, email, notification: { title, body, data } }.
 *
 * Token lookup strategy:
 *   1. FcmToken collection  (keyed by userEmail — most up-to-date)
 *   2. User.fcmToken field  (fallback for legacy records)
 *
 * FCM message is sent with android.priority = 'high' and apns-priority = 10
 * so the device wakes up even when the app is in the background or terminated.
 */

const QueueManager = require('../core/QueueManager');
const logger = require('../utils/logger').createLogger('EmergencyNotificationWorker');
const { messaging } = require('../firebase-admin-config');
const FcmToken = require('../models/FcmToken');
const User = require('../models/User');

const QUEUE_NAME = 'notifications';
const JOB_NAME   = 'emergency_alert';

/**
 * Send a single FCM push for one emergency_alert job.
 * @param {import('bullmq').Job} job
 */
const processEmergencyAlert = async (job) => {
  // Only handle the job type this worker owns; let other handlers deal with the rest.
  if (job.name !== JOB_NAME) return;

  const { userId, email, notification } = job.data;

  if (!notification || !notification.title || !notification.body) {
    logger.warn('Emergency alert job missing notification payload', { jobId: job.id, userId });
    return;
  }

  // ── 1. Resolve FCM token ─────────────────────────────────────────────────
  let fcmToken = null;

  if (email) {
    const tokenDoc = await FcmToken.findOne({ userEmail: email.toLowerCase() }).lean();
    fcmToken = tokenDoc?.fcmToken ?? null;
  }

  // Fallback: look it up directly on the User document
  if (!fcmToken && userId) {
    const user = await User.findById(userId).select('fcmToken email').lean();
    fcmToken = user?.fcmToken ?? null;

    // Also try FcmToken collection by resolved email if we didn't have one earlier
    if (!fcmToken && user?.email) {
      const tokenDoc = await FcmToken.findOne({ userEmail: user.email.toLowerCase() }).lean();
      fcmToken = tokenDoc?.fcmToken ?? null;
    }
  }

  if (!fcmToken) {
    logger.warn('No FCM token found for user — skipping push', { userId, email });
    return; // Not an error; user simply hasn't registered a device yet
  }

  // ── 2. Build FCM message ─────────────────────────────────────────────────
  // Ensure all `data` values are strings (FCM requirement)
  const stringifiedData = Object.fromEntries(
    Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)])
  );

  const fcmMessage = {
    token: fcmToken,
    notification: {
      title: notification.title,
      body:  notification.body,
    },
    data: {
      ...stringifiedData,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'emergency_alerts',
        sound:     'default',
        priority:  'high',
      },
    },
    apns: {
      headers: {
        'apns-priority':   '10',
        'apns-push-type':  'alert',
      },
      payload: {
        aps: {
          sound:            'default',
          badge:            1,
          contentAvailable: true,
        },
      },
    },
  };

  // ── 3. Send ──────────────────────────────────────────────────────────────
  try {
    const response = await messaging.send(fcmMessage);
    logger.info('Emergency push sent', {
      userId,
      email,
      broadcastId: stringifiedData.broadcastId,
      fcmMessageId: response,
    });
  } catch (fcmError) {
    // Token revoked / unregistered — remove stale token so we don't retry forever
    if (
      fcmError.code === 'messaging/registration-token-not-registered' ||
      fcmError.code === 'messaging/invalid-argument'
    ) {
      logger.warn('Stale FCM token detected — removing from DB', { userId, email });
      if (email) {
        await FcmToken.deleteOne({ userEmail: email.toLowerCase() }).catch(() => {});
      }
      if (userId) {
        await User.findByIdAndUpdate(userId, { $unset: { fcmToken: '' } }).catch(() => {});
      }
      return; // Don't re-throw; no point retrying with a dead token
    }

    logger.error('FCM send failed for emergency alert', {
      userId,
      email,
      error: fcmError.message,
      code:  fcmError.code,
    });
    throw fcmError; // Let BullMQ retry with backoff
  }
};

// Register this processor on the shared `notifications` queue
QueueManager.registerWorker(QUEUE_NAME, processEmergencyAlert);
logger.info('Emergency notification worker registered on queue: ' + QUEUE_NAME);

module.exports = { QUEUE_NAME, JOB_NAME };
