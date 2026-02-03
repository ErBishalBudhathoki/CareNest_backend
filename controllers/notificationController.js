const NotificationService = require('../services/notificationService');
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
}

module.exports = new NotificationController();
