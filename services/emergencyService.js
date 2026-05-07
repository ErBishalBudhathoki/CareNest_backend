const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');
const { messaging } = require('../firebase-admin-config');
const logger = require('../config/logger');

class EmergencyService {
  async sendBroadcast(senderId, teamIds, message, type, organizationId) {
    if (!Array.isArray(teamIds)) {
      teamIds = [teamIds];
    }

    // Create broadcast record
    const broadcast = await EmergencyBroadcast.create({
      teamId: teamIds[0],
      teamIds,
      initiatorId: senderId,
      organizationId,
      message,
      type,
      status: 'active',
      acknowledgments: []
    });

    logger.info(`Emergency broadcast created: ${broadcast._id}`);

    // Send FCM push notifications — fire and forget (never block the HTTP response)
    this._dispatchPushNotifications(broadcast._id.toString(), teamIds, senderId, message, type)
      .catch(err => logger.error('Emergency push dispatch failed', { error: err.message }));

    return broadcast;
  }

  /**
   * Asynchronously resolve all team members and send FCM pushes.
   * Runs AFTER the HTTP response is already sent — never blocks the caller.
   */
  async _dispatchPushNotifications(broadcastId, teamIds, senderId, message, type) {
    try {
      // Fetch all members across all targeted teams
      const members = await TeamMember.find({ teamId: { $in: teamIds } }).lean();
      logger.info(`Dispatching emergency push to ${members.length} team member records`);

      // Deduplicate and exclude the sender
      const senderStr = String(senderId);
      const uniqueUserIds = [
        ...new Set(
          members
            .map(m => m.userId?.toString())
            .filter(id => id && id !== senderStr)
        )
      ];

      if (uniqueUserIds.length === 0) {
        logger.info('No recipients for emergency push (sender excluded or empty teams)');
        return;
      }

      // Batch-resolve user emails and stored fcmTokens in one query
      const users = await User.find({ _id: { $in: uniqueUserIds } })
        .select('_id email fcmToken')
        .lean();

      const userMap = new Map(users.map(u => [u._id.toString(), u]));

      // Also batch-fetch from FcmToken collection (most up-to-date tokens)
      const emails = users.map(u => u.email).filter(Boolean).map(e => e.toLowerCase());
      const fcmTokenDocs = await FcmToken.find({ userEmail: { $in: emails } })
        .select('userEmail fcmToken')
        .lean();

      const emailToFcmToken = new Map(
        fcmTokenDocs.map(doc => [doc.userEmail.toLowerCase(), doc.fcmToken])
      );

      // Build FCM token list
      const tokenEntries = []; // [{ token, userId, email }]
      for (const uid of uniqueUserIds) {
        const user = userMap.get(uid);
        if (!user) continue;

        const email = user.email?.toLowerCase();
        // Prefer FcmToken collection, fall back to User.fcmToken
        const token = (email && emailToFcmToken.get(email)) || user.fcmToken || null;

        if (!token) {
          logger.debug(`No FCM token for user ${uid} (${email}) — skipping`);
          continue;
        }

        tokenEntries.push({ token, userId: uid, email });
      }

      if (tokenEntries.length === 0) {
        logger.warn('No FCM tokens found for any emergency broadcast recipients');
        return;
      }

      logger.info(`Sending emergency FCM push to ${tokenEntries.length} devices`);

      // Stringify all data values (FCM requirement)
      const dataPayload = {
        type: 'emergency_broadcast',
        broadcastId,
        teamIds: teamIds.join(','),
        priority: 'high',
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        channelId: 'emergency_alerts',
      };

      // Send in batches of 500 (FCM multicast limit)
      const BATCH_SIZE = 500;
      const staleTokens = [];

      for (let i = 0; i < tokenEntries.length; i += BATCH_SIZE) {
        const batch = tokenEntries.slice(i, i + BATCH_SIZE);
        const tokens = batch.map(e => e.token);

        const multicastMessage = {
          tokens,
          notification: {
            title: '🚨 EMERGENCY BROADCAST',
            body: message,
          },
          data: dataPayload,
          android: {
            priority: 'high',
            notification: {
              channelId: 'emergency_alerts',
              sound: 'default',
              priority: 'high',
              defaultSound: true,
              notificationCount: 1,
            },
          },
          apns: {
            headers: {
              'apns-priority': '10',
              'apns-push-type': 'alert',
            },
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                contentAvailable: true,
                mutableContent: true,
              },
            },
          },
        };

        try {
          const response = await messaging.sendEachForMulticast(multicastMessage);
          logger.info(`FCM batch sent: ${response.successCount} success, ${response.failureCount} failed`);

          // Collect stale tokens for cleanup
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const code = resp.error?.code;
              if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-argument' ||
                code === 'messaging/invalid-registration-token'
              ) {
                staleTokens.push(batch[idx]);
              } else {
                logger.warn(`FCM send failed for ${batch[idx].email}`, {
                  code,
                  error: resp.error?.message,
                });
              }
            }
          });
        } catch (batchErr) {
          logger.error('FCM multicast batch error', { error: batchErr.message });
        }
      }

      // Clean up stale tokens (non-blocking)
      if (staleTokens.length > 0) {
        this._cleanupStaleTokens(staleTokens).catch(() => {});
      }
    } catch (err) {
      logger.error('_dispatchPushNotifications error', { error: err.message, stack: err.stack });
    }
  }

  /**
   * Remove stale/revoked FCM tokens from the database.
   */
  async _cleanupStaleTokens(staleEntries) {
    for (const entry of staleEntries) {
      try {
        if (entry.email) {
          await FcmToken.deleteOne({ userEmail: entry.email.toLowerCase() });
        }
        if (entry.userId) {
          await User.findByIdAndUpdate(entry.userId, { $unset: { fcmToken: '' } });
        }
        logger.info(`Cleaned up stale FCM token for ${entry.email || entry.userId}`);
      } catch (e) {
        logger.warn('Failed to clean stale token', { error: e.message });
      }
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
