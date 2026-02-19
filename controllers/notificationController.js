const NotificationService = require('../services/notificationService');
const smartTimingService = require('../services/smartTimingService');
const logger = require('../utils/logger').createLogger('NotificationController');
const catchAsync = require('../utils/catchAsync');

class NotificationController {
  /**
   * Get notification settings for the authenticated user
   * GET /api/notifications/settings
   */
  getSettings = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const settings = await NotificationService.getSettings(userId);

    logger.business('Notification Settings Retrieved', {
      event: 'notification_settings_retrieved',
      userId,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'SETTINGS_RETRIEVED',
      data: settings
    });
  });

  /**
   * Update notification settings for the authenticated user
   * PUT /api/notifications/settings
   */
  updateSettings = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const updates = req.body;

    const settings = await NotificationService.updateSettings(userId, updates);

    logger.business('Notification Settings Updated', {
      event: 'notification_settings_updated',
      userId,
      updates: Object.keys(updates),
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'SETTINGS_UPDATED',
      data: settings,
      message: 'Notification settings updated successfully'
    });
  });

  /**
   * Get notification history
   * GET /api/notifications/history
   */
  getHistory = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const { page, limit, type } = req.query;

    const result = await NotificationService.getHistory(userId, {
      page,
      limit,
      type
    });

    logger.business('Notification History Retrieved', {
      event: 'notification_history_retrieved',
      userId,
      page: page || 1,
      type: type || 'all',
      count: result.notifications?.length || 0,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'HISTORY_RETRIEVED',
      data: result
    });
  });

  /**
   * Mark notification as read
   * PUT /api/notifications/:id/read
   */
  markAsRead = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const notificationId = req.params.id;

    const notification = await NotificationService.markAsRead(userId, notificationId);

    logger.business('Notification Marked As Read', {
      event: 'notification_marked_read',
      userId,
      notificationId,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'NOTIFICATION_MARKED_READ',
      data: notification
    });
  });

  /**
   * Get notification preferences for a user
   * GET /api/notifications/preferences/:userId
   */
  getPreferences = catchAsync(async (req, res) => {
    const { userId } = req.params;

    // In production, verify user has permission to access these preferences
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to access these preferences'
      });
    }

    // Fetch preferences from database
    // For now, return default preferences
    const preferences = {
      userId,
      categoryEnabled: {
        shiftChanges: true,
        geofence: true,
        compliance: true,
        approvals: true,
        messages: true,
        payments: true,
        system: true
      },
      categoryChannels: {
        shiftChanges: ['push', 'sms'],
        geofence: ['push'],
        compliance: ['push', 'email'],
        approvals: ['push'],
        messages: ['push', 'sms'],
        payments: ['push', 'email'],
        system: ['push']
      },
      quietHours: {
        enabled: true,
        startTime: '22:00',
        endTime: '08:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
      },
      smartTimingEnabled: true,
      geofenceEnabled: true,
      geofenceRadiusKm: 5.0,
      soundEnabled: true,
      vibrationEnabled: true,
      badgeEnabled: true,
      lastUpdated: new Date()
    };

    logger.business('Notification Preferences Retrieved', {
      event: 'notification_preferences_retrieved',
      userId,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'PREFERENCES_RETRIEVED',
      data: preferences
    });
  });

  /**
   * Update notification preferences for a user
   * PUT /api/notifications/preferences/:userId
   */
  updatePreferences = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const updates = req.body;

    // Verify permission
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to update these preferences'
      });
    }

    // In production, save to database
    // For now, just return the updated preferences
    const preferences = {
      ...updates,
      userId,
      lastUpdated: new Date()
    };

    logger.business('Notification Preferences Updated', {
      event: 'notification_preferences_updated',
      userId,
      updatedFields: Object.keys(updates),
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'PREFERENCES_UPDATED',
      data: preferences,
      message: 'Notification preferences updated successfully'
    });
  });

  /**
   * Get optimal send time for a notification
   * POST /api/notifications/smart-timing/optimal-time
   */
  getOptimalSendTime = catchAsync(async (req, res) => {
    const { userId, category, priority, quietHours } = req.body;

    if (!userId || !category || !priority) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PARAMETERS',
        message: 'userId, category, and priority are required'
      });
    }

    const recommendation = await smartTimingService.getOptimalSendTime({
      userId,
      category,
      priority,
      quietHours
    });

    logger.business('Optimal Send Time Calculated', {
      event: 'optimal_send_time_calculated',
      userId,
      category,
      priority,
      delayMinutes: recommendation.delayMinutes,
      confidence: recommendation.confidence,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'OPTIMAL_TIME_CALCULATED',
      data: recommendation
    });
  });

  /**
   * Record notification engagement
   * POST /api/notifications/smart-timing/record-engagement
   */
  recordEngagement = catchAsync(async (req, res) => {
    const { userId, category, sentAt, readAt, actionedAt } = req.body;

    if (!userId || !category || !sentAt) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PARAMETERS',
        message: 'userId, category, and sentAt are required'
      });
    }

    await smartTimingService.recordEngagement({
      userId,
      category,
      sentAt: new Date(sentAt),
      readAt: readAt ? new Date(readAt) : null,
      actionedAt: actionedAt ? new Date(actionedAt) : null
    });

    logger.business('Notification Engagement Recorded', {
      event: 'notification_engagement_recorded',
      userId,
      category,
      wasRead: !!readAt,
      wasActioned: !!actionedAt,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'ENGAGEMENT_RECORDED',
      message: 'Engagement recorded successfully'
    });
  });

  /**
   * Handle geofence event
   * POST /api/notifications/geofence/event
   */
  handleGeofenceEvent = catchAsync(async (req, res) => {
    const {
      workerId,
      workerName,
      appointmentId,
      clientName,
      clientAddress,
      eventType,
      latitude,
      longitude,
      distanceMeters
    } = req.body;

    if (!workerId || !appointmentId || !eventType) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PARAMETERS',
        message: 'workerId, appointmentId, and eventType are required'
      });
    }

    // In production, create notification and send to relevant users
    const notification = {
      eventId: `${appointmentId}_${eventType}_${Date.now()}`,
      workerId,
      workerName,
      appointmentId,
      clientName,
      clientAddress,
      eventType,
      timestamp: new Date(),
      latitude,
      longitude,
      distanceMeters
    };

    logger.business('Geofence Event Received', {
      event: 'geofence_event_received',
      workerId,
      appointmentId,
      eventType,
      distanceMeters,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'GEOFENCE_EVENT_PROCESSED',
      data: notification,
      message: 'Geofence event processed successfully'
    });
  });
}

module.exports = new NotificationController();
