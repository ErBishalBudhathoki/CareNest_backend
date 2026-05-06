const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const QueueManager = require('../core/QueueManager');
const logger = require('../config/logger');

class EmergencyService {
  async sendBroadcast(senderId, teamId, message, type) {
    // Create record with fields matching the EmergencyBroadcast model
    const broadcast = await EmergencyBroadcast.create({
      teamId,
      initiatorId: senderId,
      message,
      type,
      status: 'active',
      acknowledgments: []
    });
    
    // Send high-priority FCM notifications to all team members
    try {
      const members = await TeamMember.find({ teamId });
      logger.info(`Sending emergency notifications to ${members.length} members for team ${teamId}`);
      
      const notificationPromises = members.map(member => {
        // Skip the sender (optional, but usually good)
        if (member.userId.toString() === senderId.toString()) return Promise.resolve();
        
        return QueueManager.addJob('notifications', 'emergency_alert', {
          userId: member.userId.toString(),
          notification: {
            title: '🚨 EMERGENCY BROADCAST',
            body: message,
            data: {
              type: 'emergency_broadcast',
              broadcastId: broadcast._id.toString(),
              teamId: teamId.toString(),
              priority: 'high'
            }
          }
        });
      });
      
      await Promise.all(notificationPromises);
    } catch (err) {
      logger.error('Failed to queue emergency notifications', { error: err.message });
      // We don't throw here to avoid failing the broadcast creation if notification queue fails
    }
    
    return broadcast;
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
