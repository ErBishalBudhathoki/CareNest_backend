const QueueManager = require('../core/QueueManager');
const logger = require('../utils/logger').createLogger('NotificationWorker');
const NotificationHistory = require('../models/NotificationHistory');
const { messaging } = require('../firebase-admin-config');
const { MongoClient, ServerApiVersion } = require('mongodb');

const QUEUE_NAME = 'notifications';
const uri = process.env.MONGODB_URI;

// Define the processor function
const processNotification = async (job) => {
  const { userId, notification, historyId } = job.data;
  
  let client;
  try {
    // 1. Fetch user's FCM token
    client = new MongoClient(uri, { serverApi: ServerApiVersion.v1, tls: true, family: 4 });
    await client.connect();
    const db = client.db('Invoice');
    const usersCollection = db.collection('login');
    
    // Note: SecureAuthController stores userId as a string field, separate from _id
    const user = await usersCollection.findOne({ userId: userId });
    
    if (!user || !user.fcmToken) {
      logger.warn(`No FCM token found for user ${userId}`);
      if (historyId) {
        await NotificationHistory.findByIdAndUpdate(historyId, {
          status: 'failed',
          error: 'No FCM token registered'
        });
      }
      return;
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
    const messageId = response.split('/').pop(); // extracting ID if needed
    
    // 3. Update history
    if (historyId) {
      await NotificationHistory.findByIdAndUpdate(historyId, {
        status: 'delivered',
        deliveredAt: new Date(),
        fcmMessageId: messageId
      });
    }
    
    logger.info(`Notification sent successfully: ${messageId}`);

  } catch (error) {
    logger.error('Failed to send notification', { error: error.message, jobId: job.id });
    
    if (historyId) {
      await NotificationHistory.findByIdAndUpdate(historyId, {
        status: 'failed',
        error: error.message
      });
    }
    
    // Check if error is due to invalid token
    if (error.code === 'messaging/registration-token-not-registered' || 
        error.code === 'messaging/invalid-argument') {
       // Optionally invalidate token in DB
       logger.warn(`Invalid token for user ${userId}, consider removing it.`);
    }
    
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
};

// Register the worker
QueueManager.registerWorker(QUEUE_NAME, processNotification);

module.exports = {
  QUEUE_NAME
};
