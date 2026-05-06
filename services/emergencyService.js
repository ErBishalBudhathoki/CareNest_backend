const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const QueueManager = require('../core/QueueManager');
const logger = require('../config/logger');

class EmergencyService {
  async sendBroadcast(senderId, teamIds, message, type, organizationId) {
    if (!Array.isArray(teamIds)) {
      teamIds = [teamIds];
    }

    // Create record with fields matching the EmergencyBroadcast model
    const broadcast = await EmergencyBroadcast.create({
      teamId: teamIds[0], // Primary teamId for backward compatibility
      teamIds,
      initiatorId: senderId,
      organizationId,
      message,
      type,
      status: 'active',
      acknowledgments: []
    });
    
    // Send high-priority FCM notifications to all team members across all selected teams
    try {
      const members = await TeamMember.find({ teamId: { $in: teamIds } });
      logger.info(`Sending emergency notifications to ${members.length} members across ${teamIds.length} teams`);
      
      const notificationPromises = members.map(member => {
        // Skip the sender
        if (member.userId.toString() === senderId.toString()) return Promise.resolve();
        
        return QueueManager.addJob('notifications', 'emergency_alert', {
          userId: member.userId.toString(),
          notification: {
            title: '🚨 EMERGENCY BROADCAST',
            body: message,
            data: {
              type: 'emergency_broadcast',
              broadcastId: broadcast._id.toString(),
              teamIds: teamIds.join(','),
              priority: 'high'
            }
          }
        });
      });
      
      await Promise.all(notificationPromises);
    } catch (err) {
      logger.error('Failed to queue emergency notifications', { error: err.message });
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
