const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger').createLogger('NotificationController');

class NotificationController {
  /**
   * Get notification settings for the authenticated user
   * GET /api/notifications/settings
   */
  async getSettings(req, res) {
    try {
      const userId = req.user.userId;
      const settings = await NotificationService.getSettings(userId);

      return res.status(200).json({
        success: true,
        data: settings
      });
    } catch (error) {
      logger.error('Error fetching notification settings', { error: error.message, userId: req.user.userId });
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch notification settings'
      });
    }
  }

  /**
   * Update notification settings for the authenticated user
   * PUT /api/notifications/settings
   */
  async updateSettings(req, res) {
    try {
      const userId = req.user.userId;
      const updates = req.body;

      const settings = await NotificationService.updateSettings(userId, updates);

      return res.status(200).json({
        success: true,
        data: settings,
        message: 'Notification settings updated successfully'
      });
    } catch (error) {
      logger.error('Error updating notification settings', { error: error.message, userId: req.user.userId });
      return res.status(500).json({
        success: false,
        message: 'Failed to update notification settings'
      });
    }
  }

  /**
   * Get notification history
   * GET /api/notifications/history
   */
  async getHistory(req, res) {
    try {
      const userId = req.user.userId;
      const { page, limit, type } = req.query;

      const result = await NotificationService.getHistory(userId, {
        page,
        limit,
        type
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error fetching notification history', { error: error.message, userId: req.user.userId });
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch notification history'
      });
    }
  }

  /**
   * Mark notification as read
   * PUT /api/notifications/:id/read
   */
  async markAsRead(req, res) {
    try {
      const userId = req.user.userId;
      const notificationId = req.params.id;

      const notification = await NotificationService.markAsRead(userId, notificationId);

      return res.status(200).json({
        success: true,
        data: notification
      });
    } catch (error) {
      logger.error('Error marking notification as read', { error: error.message, userId: req.user.userId, notificationId: req.params.id });
      
      if (error.message === 'Notification not found') {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read'
      });
    }
  }
}

module.exports = new NotificationController();
