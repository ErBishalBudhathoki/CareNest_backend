const NotificationService = require('../services/notificationService');
const smartTimingService = require('../services/smartTimingService');
const logger = require('../utils/logger').createLogger('NotificationController');
const catchAsync = require('../utils/catchAsync');
const NotificationPreference = require('../models/NotificationPreference');

const normalizeValue = (value) => (value || '').toString().trim();
const normalizeEmail = (value) => normalizeValue(value).toLowerCase();

const hasAdminPrivileges = (reqUser) => {
  const roles = Array.isArray(reqUser?.roles)
    ? reqUser.roles.map((role) => role.toString().toLowerCase())
    : [];
  const role = reqUser?.role?.toString().toLowerCase();
  return (
    roles.includes('admin') ||
    roles.includes('superadmin') ||
    role === 'admin' ||
    role === 'superadmin'
  );
};

const buildDefaultPreferences = (userId, userEmail = null) => ({
  userId,
  userEmail: userEmail || undefined,
  categoryEnabled: {
    shiftChanges: true,
    geofence: true,
    compliance: true,
    approvals: true,
    messages: true,
    payments: true,
    system: true,
  },
  categoryChannels: {
    shiftChanges: ['push', 'sms'],
    geofence: ['push'],
    compliance: ['push', 'email'],
    approvals: ['push'],
    messages: ['push', 'sms'],
    payments: ['push', 'email'],
    system: ['push'],
  },
  quietHours: {
    enabled: true,
    startTime: '22:00',
    endTime: '08:00',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  },
  smartTimingEnabled: true,
  geofenceEnabled: true,
  geofenceRadiusKm: 5.0,
  soundEnabled: true,
  vibrationEnabled: true,
  badgeEnabled: true,
  lastUpdated: new Date(),
});

const sanitizePreferenceUpdates = (updates = {}) => {
  const safe = {};
  if (updates.categoryEnabled && typeof updates.categoryEnabled === 'object') {
    safe.categoryEnabled = updates.categoryEnabled;
  }
  if (updates.categoryChannels && typeof updates.categoryChannels === 'object') {
    safe.categoryChannels = updates.categoryChannels;
  }
  if (updates.quietHours && typeof updates.quietHours === 'object') {
    safe.quietHours = {
      enabled:
        updates.quietHours.enabled === undefined
          ? true
          : !!updates.quietHours.enabled,
      startTime: normalizeValue(updates.quietHours.startTime || '22:00'),
      endTime: normalizeValue(updates.quietHours.endTime || '08:00'),
      daysOfWeek: Array.isArray(updates.quietHours.daysOfWeek)
        ? updates.quietHours.daysOfWeek
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : [0, 1, 2, 3, 4, 5, 6],
    };
  }

  if (updates.smartTimingEnabled !== undefined) {
    safe.smartTimingEnabled = !!updates.smartTimingEnabled;
  }
  if (updates.geofenceEnabled !== undefined) {
    safe.geofenceEnabled = !!updates.geofenceEnabled;
  }
  if (updates.geofenceRadiusKm !== undefined) {
    const radius = Number(updates.geofenceRadiusKm);
    if (Number.isFinite(radius)) {
      safe.geofenceRadiusKm = Math.min(Math.max(radius, 0.1), 20.0);
    }
  }
  if (updates.soundEnabled !== undefined) {
    safe.soundEnabled = !!updates.soundEnabled;
  }
  if (updates.vibrationEnabled !== undefined) {
    safe.vibrationEnabled = !!updates.vibrationEnabled;
  }
  if (updates.badgeEnabled !== undefined) {
    safe.badgeEnabled = !!updates.badgeEnabled;
  }

  safe.lastUpdated = new Date();
  return safe;
};

const resolvePreferenceTarget = (reqUser, requestedUserId) => {
  const requested = normalizeValue(requestedUserId);
  const requestUserId = normalizeValue(reqUser?.userId);
  const requestUserEmail = normalizeEmail(reqUser?.email);
  const isAdmin = hasAdminPrivileges(reqUser);

  if (isAdmin) {
    return {
      allowed: true,
      isAdmin: true,
      targetUserId: requested || requestUserId,
      targetUserEmail: null,
    };
  }

  const canAccess =
    requested === requestUserId ||
    requested === requestUserEmail ||
    requested.length === 0;

  if (!canAccess) {
    return {
      allowed: false,
      isAdmin: false,
      targetUserId: requestUserId,
      targetUserEmail: requestUserEmail,
    };
  }

  return {
    allowed: true,
    isAdmin: false,
    targetUserId: requestUserId || requested || requestUserEmail,
    targetUserEmail: requestUserEmail || null,
  };
};

const buildPreferenceQuery = (targetUserId, targetUserEmail = null) => {
  const clauses = [];
  if (targetUserId) {
    clauses.push({ userId: targetUserId });
  }
  if (targetUserEmail) {
    clauses.push({ userEmail: targetUserEmail });
  }
  if (clauses.length === 0) {
    return { userId: '__missing__' };
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return { $or: clauses };
};

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
    const target = resolvePreferenceTarget(req.user, userId);

    if (!target.allowed) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to access these preferences'
      });
    }

    if (!target.targetUserId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_USER_CONTEXT',
        message: 'Unable to resolve notification preference user ID',
      });
    }

    const query = buildPreferenceQuery(
      target.targetUserId,
      target.targetUserEmail
    );
    let preferences = await NotificationPreference.findOne(query).lean();

    if (!preferences) {
      const defaultPreferences = buildDefaultPreferences(
        target.targetUserId,
        target.targetUserEmail
      );
      const created = await NotificationPreference.findOneAndUpdate(
        { userId: target.targetUserId },
        {
          $setOnInsert: defaultPreferences,
          ...(target.targetUserEmail
            ? { $set: { userEmail: target.targetUserEmail } }
            : {}),
        },
        { upsert: true, new: true, runValidators: true }
      ).lean();
      preferences = created;
    }

    logger.business('Notification Preferences Retrieved', {
      event: 'notification_preferences_retrieved',
      userId: target.targetUserId,
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
    const target = resolvePreferenceTarget(req.user, userId);

    if (!target.allowed) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to update these preferences'
      });
    }

    if (!target.targetUserId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_USER_CONTEXT',
        message: 'Unable to resolve notification preference user ID',
      });
    }

    const safeUpdates = sanitizePreferenceUpdates(updates);
    const query = buildPreferenceQuery(
      target.targetUserId,
      target.targetUserEmail
    );

    const preferences = await NotificationPreference.findOneAndUpdate(
      query,
      {
        $set: {
          ...safeUpdates,
          userId: target.targetUserId,
          ...(target.targetUserEmail
            ? { userEmail: target.targetUserEmail }
            : {}),
        },
        $setOnInsert: buildDefaultPreferences(
          target.targetUserId,
          target.targetUserEmail
        ),
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    ).lean();

    logger.business('Notification Preferences Updated', {
      event: 'notification_preferences_updated',
      userId: target.targetUserId,
      updatedFields: Object.keys(safeUpdates),
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
