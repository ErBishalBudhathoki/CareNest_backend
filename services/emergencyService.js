const EmergencyBroadcast = require('../models/EmergencyBroadcast');

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

    // In a real implementation, we'd send high-priority FCM notifications here
    
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
