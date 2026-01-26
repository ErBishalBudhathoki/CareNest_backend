/**
 * Active Timers Controller
 * Handles database-backed timer tracking for employee monitoring
 * 
 * @file backend/controllers/activeTimerController.js
 */

const ActiveTimer = require('../models/ActiveTimer');
const WorkedTime = require('../models/WorkedTime');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');
const { messaging } = require('../firebase-admin-config');
const logger = require('../config/logger');

/**
 * ===========================================================================
 * NOTIFICATION HELPER - TARGETED FOR ADMINS (Centralized Logic)
 * ===========================================================================
 * This function finds and notifies ONLY the admin users within a specific organization.
 */
async function sendAdminNotification(organizationId, title, body, data) {
  logger.info('Admin notification flow started', {
    type: data.type,
    organizationId,
    timestamp: new Date().toISOString()
  });

  try {
    // Primary: Get admins with FCM tokens directly from login collection
    const adminUsers = await User.find({
      organizationId: organizationId,
      isActive: { $ne: false },
      $or: [
        { role: { $regex: /^admin$/i } },
        { roles: { $elemMatch: { $regex: /^admin$/i } } },
        { jobRole: { $regex: /^admin$/i } },
      ],
    }).select('email fcmToken role roles jobRole').lean();

    if (adminUsers.length === 0) {
      logger.warn('No active admin users found for organization', {
        organizationId,
        type: data.type
      });
      return;
    }

    logger.info('Admin users found in DB query:', {
      count: adminUsers.length,
      details: adminUsers.map(u => ({
        email: u.email,
        role: u.role,
        roles: u.roles,
        jobRole: u.jobRole,
        hasToken: !!u.fcmToken
      }))
    });

    const adminEmails = adminUsers.map(user => user.email).filter(Boolean);

    let validTokens = adminUsers
      .filter(user => user.fcmToken && user.fcmToken.trim() !== '')
      .map(user => user.fcmToken);
    
    logger.info(`Found ${validTokens.length} FCM tokens in login collection for admins`);

    const tokenDocs = adminEmails.length > 0
      ? await FcmToken.find({
          organizationId: organizationId,
          userEmail: { $in: adminEmails },
          fcmToken: { $exists: true, $nin: [null, ''] }
        }).select('fcmToken').lean()
      : [];

    const tokenDocTokens = tokenDocs.map(doc => doc.fcmToken).filter(Boolean);
    logger.info(`Found ${tokenDocTokens.length} FCM tokens in fcmTokens collection for admins`);

    validTokens = validTokens.concat(tokenDocTokens);
    
    // Deduplicate tokens
    validTokens = [...new Set(validTokens)];

    if (validTokens.length === 0) {
      logger.warn('No admin FCM tokens found for organization', {
        organizationId,
        type: data.type,
        adminCount: adminUsers.length
      });
      return;
    }

    logger.info('Found admin users to notify', {
      organizationId,
      adminCount: adminUsers.length,
      adminEmails: adminUsers.map(u => u.email),
      tokenCount: validTokens.length
    });

    // 2. Construct the robust "Notification + Data" message payload.
    const message = {
      notification: { title, body },
      data: {
        ...data, // Includes type, employeeEmail, etc.
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        channelId: data.channelId || 'timer_alerts',
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: data.channelId || 'timer_alerts',
          sound: 'default',
        },
      },
      apns: {
        payload: { aps: { sound: 'default', 'content-available': 1 } },
        headers: { 'apns-priority': '10' },
      },
      tokens: validTokens,
    };

    // 3. Send the notification and handle the response.
    logger.info('Sending notification to admins', {
      organizationId,
      type: data.type,
      tokenCount: validTokens.length
    });
    
    const fcmResponse = await messaging.sendEachForMulticast(message);
    
    logger.info('FCM notification response', {
      organizationId,
      type: data.type,
      successCount: fcmResponse.successCount,
      failureCount: fcmResponse.failureCount
    });

    // 4. Clean up any invalid tokens from the database.
    if (fcmResponse.failureCount > 0) {
      const tokensToRemove = [];
      fcmResponse.responses.forEach((response, index) => {
        if (!response.success) {
          const errorCode = response.error.code;
          if (['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(errorCode)) {
            tokensToRemove.push(validTokens[index]);
          }
        }
      });
      
      if (tokensToRemove.length > 0) {
        await FcmToken.deleteMany(
          { organizationId: organizationId, fcmToken: { $in: tokensToRemove } }
        );
        await User.updateMany(
          { fcmToken: { $in: tokensToRemove } },
          { $unset: { fcmToken: "" } }
        );
        
        logger.info('Removed invalid FCM tokens from login collection', {
          organizationId,
          removedTokenCount: tokensToRemove.length
        });
      }
    }
  } catch (error) {
    logger.error('Failed to send admin notification', {
      error: error.message,
      stack: error.stack,
      organizationId,
      type: data.type
    });
  } finally {
    logger.info('Admin notification flow completed', {
      organizationId,
      type: data.type
    });
  }
}

class ActiveTimerController {
  /**
   * Start timer with database persistence
   * POST /api/active-timers/start
   */
  static async startTimer(req, res) {
    try {
      const { userEmail, clientEmail, organizationId } = req.body;
      if (!userEmail || !clientEmail || !organizationId) {
        return res.status(400).json({ success: false, message: 'Missing required fields: userEmail, clientEmail, organizationId' });
      }

      const existingTimer = await ActiveTimer.findOne({ userEmail });
      if (existingTimer) {
        return res.status(409).json({ success: false, message: 'User already has an active timer running.' });
      }

      const timerData = { userEmail, clientEmail, organizationId, startTime: new Date() };
      const newTimer = await ActiveTimer.create(timerData);
      
      logger.info('Timer started successfully', {
        userEmail,
        clientEmail,
        organizationId,
        timerId: newTimer._id
      });

      // --- NOTIFICATION LOGIC ---
      // 1. Notify the employee who started the timer.
      // Primary: Get FCM token from login collection
      const userDoc = await User.findOne({ 
        email: userEmail,
        fcmToken: { $exists: true, $nin: [null, ''] }
      }).lean();
      
      let userTokens = [];
      if (userDoc && userDoc.fcmToken) {
        userTokens = [userDoc.fcmToken];
        logger.info(`Found FCM token in login collection for ${userEmail}`);
      } else {
        // Fallback: Check fcmTokens collection
        const userTokenDocs = await FcmToken.find({
          organizationId: organizationId,
          userEmail: userEmail,
          fcmToken: { $exists: true, $nin: [null, ''] }
        }).select('fcmToken').lean();
        userTokens = [...new Set(userTokenDocs.map(doc => doc.fcmToken).filter(Boolean))];
        if (userTokens.length > 0) {
          logger.info(`Found FCM token in fcmTokens collection for ${userEmail}`);
        }
      }

      if (userTokens.length > 0) {
        try {
          await messaging.sendEachForMulticast({
            tokens: userTokens,
            notification: { title: '⏱️ Timer Started', body: `Your timer for client ${clientEmail} has started.` },
            data: {
              type: 'TIMER_START',
              clientEmail,
              title: '⏱️ Timer Started',
              body: `Your timer for client ${clientEmail} has started.`,
              channelId: 'timer_alerts',
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
              timestamp: new Date().toISOString(),
            },
            android: {
              priority: 'high',
              notification: {
                channel_id: 'timer_alerts',
                sound: 'default',
              },
            },
            apns: {
              payload: { aps: { sound: 'default', 'content-available': 1 } },
              headers: { 'apns-priority': '10' },
            },
          });
          logger.info(`Timer start notification sent to ${userEmail}`);
        } catch (e) {
          logger.error('Failed to notify employee', { error: e.message, userEmail });
        }
      } else {
        logger.warn(`No FCM token found for user ${userEmail}`);
      }

      // 2. Notify ONLY the admins of the organization.
      await sendAdminNotification(
        organizationId,
        '👤 Employee Started Shift',
        `${userEmail} started working with client ${clientEmail}`,
        {
          type: 'EMPLOYEE_TIMER_START',
          employeeEmail: userEmail,
          clientEmail: clientEmail,
        }
      );

      res.status(200).json({ success: true, message: 'Timer started successfully', timerId: newTimer._id });

    } catch (error) {
      logger.error('Error starting timer', {
        error: error.message,
        stack: error.stack,
        timerData: req.body
      });
      res.status(500).json({ success: false, message: 'Internal server error while starting timer' });
    }
  }

  /**
   * Stop timer and create worked time record
   * POST /api/active-timers/stop
   */
  static async stopTimer(req, res) {
    try {
      const { userEmail, organizationId } = req.body;
      if (!userEmail || !organizationId) {
        return res.status(400).json({ success: false, message: 'Missing required fields: userEmail, organizationId' });
      }

      logger.info('Looking for active timer', { userEmail });
      const activeTimer = await ActiveTimer.findOneAndDelete({ userEmail });
      
      logger.info('Active timer query result', {
        userEmail,
        timerFound: !!activeTimer
      });
      
      if (!activeTimer) {
        logger.warn('No active timer found for user', { userEmail });
        return res.status(404).json({ success: false, message: 'No active timer found for this user.' });
      }

      const timerDoc = activeTimer;
      logger.info('Timer document retrieved', {
        userEmail,
        clientEmail: timerDoc.clientEmail,
        startTime: timerDoc.startTime
      });
      const stopTime = new Date();
      const startTime = timerDoc.startTime;
      const totalSeconds = Math.floor((stopTime.getTime() - startTime.getTime()) / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

      await WorkedTime.create({
        userEmail,
        clientEmail: timerDoc.clientEmail,
        organizationId,
        startTime,
        endTime: stopTime,
        timeWorked: totalSeconds,
        totalSeconds,
        createdAt: new Date(),
      });
      
      logger.info('Timer stopped and worked time recorded', {
        userEmail,
        clientEmail: timerDoc.clientEmail,
        organizationId,
        timeWorked: formattedTime,
        totalSeconds
      });

      // --- NOTIFICATION LOGIC ---
      // 1. Notify the employee who stopped the timer.
      // Primary: Get FCM token from login collection
      const userDoc = await User.findOne({ 
        email: userEmail,
        fcmToken: { $exists: true, $nin: [null, ''] }
      }).lean();
      
      let userTokens = [];
      if (userDoc && userDoc.fcmToken) {
        userTokens = [userDoc.fcmToken];
        logger.info(`Found FCM token in login collection for ${userEmail}`);
      } else {
        // Fallback: Check fcmTokens collection
        const userTokenDocs = await FcmToken.find({
          organizationId: organizationId,
          userEmail: userEmail,
          fcmToken: { $exists: true, $nin: [null, ''] }
        }).select('fcmToken').lean();
        userTokens = [...new Set(userTokenDocs.map(doc => doc.fcmToken).filter(Boolean))];
        if (userTokens.length > 0) {
          logger.info(`Found FCM token in fcmTokens collection for ${userEmail}`);
        }
      }

      if (userTokens.length > 0) {
        try {
          const message = {
            tokens: userTokens,
            notification: { title: '⏱️ Timer Stopped', body: `Time worked: ${formattedTime}` },
            data: {
              type: 'TIMER_STOP',
              clientEmail: timerDoc.clientEmail,
              timeWorked: formattedTime,
              title: '⏱️ Timer Stopped',
              body: `Time worked: ${formattedTime}`,
              channelId: 'timer_alerts',
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
              timestamp: new Date().toISOString(),
            },
            android: {
              priority: 'high',
              notification: {
                channel_id: 'timer_alerts',
                sound: 'default',
              },
            },
            apns: {
              payload: { aps: { sound: 'default', 'content-available': 1 } },
              headers: { 'apns-priority': '10' },
            },
          };
          const fcmResponse = await messaging.sendEachForMulticast(message);
          logger.info(`Timer stop notification sent to ${userEmail}`);
          if (fcmResponse.failureCount > 0) {
            const tokensToRemove = [];
            fcmResponse.responses.forEach((response, index) => {
              if (!response.success) {
                const errorCode = response.error.code;
                if (['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(errorCode)) {
                  tokensToRemove.push(userTokens[index]);
                }
              }
            });
            if (tokensToRemove.length > 0) {
              await FcmToken.deleteMany(
                { organizationId: organizationId, fcmToken: { $in: tokensToRemove } }
              );
              await User.updateMany(
                { fcmToken: { $in: tokensToRemove } },
                { $unset: { fcmToken: "" } }
              );
            }
          }
        } catch (e) {
          logger.error('Failed to notify employee', { error: e.message, code: e.code, userEmail });
        }
      } else {
        logger.warn(`No FCM token found for user ${userEmail}`);
      }

      // 2. Notify ONLY the admins of the organization.
      await sendAdminNotification(
        organizationId,
        '👤 Employee Ended Shift',
        `${userEmail} finished working with client ${timerDoc.clientEmail}. Duration: ${formattedTime}`,
        {
          type: 'EMPLOYEE_TIMER_STOP',
          employeeEmail: userEmail,
          clientEmail: timerDoc.clientEmail,
          timeWorked: formattedTime,
        }
      );

      res.status(200).json({ success: true, message: 'Timer stopped successfully', timeWorked: formattedTime, totalSeconds });

    } catch (error) {
      logger.error('Error stopping timer', {
        error: error.message,
        stack: error.stack,
        timerId: req.params.timerId
      });
      res.status(500).json({ success: false, message: 'Internal server error while stopping timer' });
    }
  }

  /**
   * Get active timers for an organization
   * GET /api/active-timers/:organizationId
   */
  static async getActiveTimers(req, res) {
    try {
      const { organizationId } = req.params;
      const activeTimers = await ActiveTimer.find({ organizationId }).lean();
      res.status(200).json({ success: true, activeTimers, count: activeTimers.length });
    } catch (error) {
      logger.error('Error getting active timers', {
        error: error.message,
        stack: error.stack,
        organizationId: req.params.organizationId
      });
      res.status(500).json({ success: false, message: 'Internal server error while getting active timers' });
    }
  }
}

module.exports = ActiveTimerController;
