const { messaging } = require('../../firebase-admin-config');
const FcmToken = require('../../models/FcmToken');
const User = require('../../models/User');
const logger = require('../../utils/logger').createLogger('EmergencyActivity');

/**
 * Send an emergency FCM push notification.
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.email
 * @param {Object} params.notification
 */
async function sendEmergencyPush({ userId, email, notification }) {
  if (!notification || !notification.title || !notification.body) {
    logger.warn('Emergency alert missing notification payload', { userId });
    return { success: false, reason: 'Missing payload' };
  }

  // 1. Resolve FCM token
  let fcmToken = null;

  if (email) {
    const tokenDoc = await FcmToken.findOne({ userEmail: email.toLowerCase() }).lean();
    fcmToken = tokenDoc?.fcmToken ?? null;
  }

  if (!fcmToken && userId) {
    const user = await User.findById(userId).select('fcmToken email').lean();
    fcmToken = user?.fcmToken ?? null;

    if (!fcmToken && user?.email) {
      const tokenDoc = await FcmToken.findOne({ userEmail: user.email.toLowerCase() }).lean();
      fcmToken = tokenDoc?.fcmToken ?? null;
    }
  }

  if (!fcmToken) {
    logger.warn('No FCM token found for user — skipping push', { userId, email });
    return { success: false, reason: 'No FCM token' };
  }

  // 2. Build FCM message
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

  // 3. Send
  try {
    const response = await messaging.send(fcmMessage);
    logger.info('Emergency push sent', {
      userId,
      email,
      broadcastId: stringifiedData.broadcastId,
      fcmMessageId: response,
    });
    return { success: true, messageId: response };
  } catch (fcmError) {
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
      return { success: false, reason: 'Stale FCM token' };
    }

    logger.error('FCM send failed for emergency alert', {
      userId,
      email,
      error: fcmError.message,
      code:  fcmError.code,
    });
    // Throw to trigger Temporal retries
    throw fcmError;
  }
}

module.exports = {
  sendEmergencyPush
};
