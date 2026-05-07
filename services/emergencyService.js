const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const QueueManager = require('../core/QueueManager');
const FcmToken = require('../models/FcmToken');
const { messaging } = require('../firebase-admin-config');
const logger = require('../config/logger');

class EmergencyService {
  async sendBroadcast(senderId, teamIds, message, type, organizationId) {
    if (!Array.isArray(teamIds)) {
      teamIds = [teamIds];
    }

    // Create record with fields matching the EmergencyBroadcast model
    const broadcast = await EmergencyBroadcast.create({
      teamId: teamIds[0], // Primary teamId for backward compatibility
      teamIds,
      initiatorId: senderId,
      organizationId,
      message,
      type,
      status: 'active',
      acknowledgments: []
    });

    // Send high-priority FCM notifications to all team members across all selected teams
    try {
      const members = await TeamMember.find({ teamId: { $in: teamIds } });
      logger.info(`Sending emergency notifications to ${members.length} members across ${teamIds.length} teams`);

      // Resolve user emails in one query so the worker (and fallback) can look up FCM tokens
      const memberUserIds = members
        .map(m => m.userId?.toString())
        .filter(id => id && id !== senderId.toString());

      const uniqueUserIds = [...new Set(memberUserIds)];

      const userRecords = await User.find({ _id: { $in: uniqueUserIds } })
        .select('_id email fcmToken')
        .lean();

      // Build userId → { email, fcmToken } map for fast lookup
      const userMap = new Map(
        userRecords.map(u => [u._id.toString(), { email: u.email, fcmToken: u.fcmToken }])
      );

      const notificationPayload = {
        title: '🚨 EMERGENCY BROADCAST',
        body: message,
        data: {
          type: 'emergency_broadcast',
          broadcastId: broadcast._id.toString(),
          teamIds: teamIds.join(','),
          priority: 'high'
        }
      };

      const notificationPromises = uniqueUserIds.map(async (uid) => {
        const userInfo = userMap.get(uid) || {};
        const userEmail = userInfo.email || null;

        // Try to enqueue via BullMQ (primary path when Redis is available)
        const job = await QueueManager.addJob('notifications', 'emergency_alert', {
          userId: uid,
          email: userEmail,
          notification: notificationPayload
        });

        // Fallback: if queuing returned null (Redis disabled / queue unavailable),
        // send the FCM push synchronously so no notification is lost.
        // Wrapped in try/catch so a single FCM failure never blocks the broadcast response.
        if (job === null) {
          await this._sendFcmDirect(uid, userEmail, userInfo.fcmToken, notificationPayload);
        }
      });

      await Promise.all(notificationPromises);
    } catch (err) {
      // Notification failures must never prevent the broadcast record from being returned.
      logger.error('Failed to dispatch emergency notifications', { error: err.message });
    }

    return broadcast;
  }

  /**
   * Direct FCM send — used as a synchronous fallback when BullMQ is unavailable.
   * Errors are swallowed so they never bubble up to the HTTP layer.
   */
  async _sendFcmDirect(userId, email, cachedFcmToken, notification) {
    try {
      let fcmToken = cachedFcmToken || null;

      if (!fcmToken && email) {
        const tokenDoc = await FcmToken.findOne({ userEmail: email.toLowerCase() }).lean();
        fcmToken = tokenDoc?.fcmToken ?? null;
      }

      if (!fcmToken) {
        logger.debug('No FCM token for direct send', { userId, email });
        return;
      }

      const stringifiedData = Object.fromEntries(
        Object.entries(notification.data || {}).map(([k, v]) => [k, String(v)])
      );

      await messaging.send({
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
          notification: { channelId: 'emergency_alerts', sound: 'default', priority: 'high' },
        },
        apns: {
          headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
          payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
        },
      });

      logger.info('Emergency push sent (direct fallback)', {
        userId,
        email,
        broadcastId: notification.data?.broadcastId,
      });
    } catch (err) {
      logger.error('Direct FCM send failed (non-fatal)', { userId, email, error: err.message });
    }
  }

  async acknowledge(broadcastId, userId) {
    const broadcast = await EmergencyBroadcast.findByIdAndUpdate(
      broadcastId,
      { $addToSet: { acknowledgments: userId } },
      { new: true }
    );

    if (!broadcast) throw new Error('Broadcast not found');
    return broadcast;
  }
}

module.exports = new EmergencyService();
