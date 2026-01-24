const NotificationSetting = require('../models/NotificationSetting');
const NotificationHistory = require('../models/NotificationHistory');

class NotificationService {
  /**
   * Get notification settings for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Notification settings
   */
  async getSettings(userId) {
    let settings = await NotificationSetting.findOne({ userId });

    if (!settings) {
      // Create default settings if not found
      settings = await NotificationSetting.create({ userId });
    }

    return settings;
  }

  /**
   * Update notification settings for a user
   * @param {string} userId - User ID
   * @param {Object} updates - Settings updates
   * @returns {Promise<Object>} Updated settings
   */
  async updateSettings(userId, updates) {
    const settings = await NotificationSetting.findOneAndUpdate(
      { userId },
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );
    return settings;
  }

  /**
   * Get notification history for a user
   * @param {string} userId - User ID
   * @param {Object} options - Filter and pagination options
   * @returns {Promise<Object>} Notification history and pagination info
   */
  async getHistory(userId, { page = 1, limit = 20, type } = {}) {
    const query = { userId };
    if (type) {
      query.type = type;
    }

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      NotificationHistory.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NotificationHistory.countDocuments(query)
    ]);

    return {
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Mark a notification as read
   * @param {string} userId - User ID
   * @param {string} notificationId - Notification ID
   * @returns {Promise<Object>} Updated notification
   */
  async markAsRead(userId, notificationId) {
    const notification = await NotificationHistory.findOneAndUpdate(
      { _id: notificationId, userId },
      { 
        $set: { 
          status: 'read',
          readAt: new Date()
        } 
      },
      { new: true }
    );

    if (!notification) {
      throw new Error('Notification not found');
    }

    return notification;
  }

  /**
   * Create a history record for a sent notification
   * @param {Object} data - Notification data
   * @returns {Promise<Object>} Created history record
   */
  async createHistory(data) {
    return await NotificationHistory.create(data);
  }
}

module.exports = new NotificationService();
