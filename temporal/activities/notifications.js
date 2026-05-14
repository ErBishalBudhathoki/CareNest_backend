const { messaging } = require('../../firebase-admin-config');
const { MongoClient, ServerApiVersion } = require('mongodb');
const NotificationHistory = require('../../models/NotificationHistory');
const logger = require('../../utils/logger').createLogger('NotificationActivity');

const uri = process.env.MONGODB_URI;

/**
 * Temporal Activity to send a standard push notification.
 * @param {Object} params
 * @param {string} params.userId
 * @param {Object} params.notification
 * @param {string} [params.historyId]
 */
async function sendPushNotification({ userId, notification, historyId }) {
  let client;
  try {
    // 1. Fetch user's FCM token
    client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    await client.connect();
    const db = client.db('Invoice');
    const usersCollection = db.collection('login');
    
    const user = await usersCollection.findOne({ userId: userId });
    
    if (!user || !user.fcmToken) {
      logger.warn(`No FCM token found for user ${userId}`);
      if (historyId) {
        await NotificationHistory.findByIdAndUpdate(historyId, {
          status: 'failed',
          error: 'No FCM token registered'
        });
      }
      return { success: false, reason: 'No FCM token' };
    }

    const token = user.fcmToken;
    
    logger.info(`Sending notification to user ${userId} (${notification.title})`);
    
    // 2. Send via Firebase
    const message = {
      token: token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...notification.data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } }
    };

    const response = await messaging.send(message);
    const messageId = response.split('/').pop(); 
    
    // 3. Update history
    if (historyId) {
      await NotificationHistory.findByIdAndUpdate(historyId, {
        status: 'delivered',
        deliveredAt: new Date(),
        fcmMessageId: messageId
      });
    }
    
    logger.info(`Notification sent successfully: ${messageId}`);
    return { success: true, messageId };

  } catch (error) {
    logger.error('Failed to send notification', { error: error.message });
    
    if (historyId) {
      await NotificationHistory.findByIdAndUpdate(historyId, {
        status: 'failed',
        error: error.message
      });
    }
    
    // Check if error is due to invalid token
    if (error.code === 'messaging/registration-token-not-registered' || 
        error.code === 'messaging/invalid-argument') {
       logger.warn(`Invalid token for user ${userId}, consider removing it.`);
       // Do not throw so the workflow doesn't retry indefinitely for a bad token
       return { success: false, reason: 'Invalid token' };
    }
    
    // Throw other errors to trigger Temporal's automatic retries
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

module.exports = {
  sendPushNotification
};
