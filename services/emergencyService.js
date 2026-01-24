const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const { messaging } = require('../firebase-admin-config'); // Assuming this exists from previous task

class EmergencyService {
  async sendBroadcast(senderId, teamId, message, priority) {
    // 1. Get Recipients
    const members = await TeamMember.find({ teamId });
    const recipients = members.map(m => ({
      userId: m.userId,
      status: 'pending'
    }));

    // 2. Create Record
    const broadcast = await EmergencyBroadcast.create({
      teamId,
      senderId,
      message,
      priorityLevel: priority,
      recipients
    });

    // 3. Send Notifications (Override all DND)
    // In a real implementation, we'd loop through users, get their FCM tokens, and send high-priority messages
    // For now, we simulate the sending logic or call a notification helper
    
    // Simulate updating status
    broadcast.deliveryStatus = {
      total: recipients.length,
      sent: recipients.length,
      acknowledged: 0
    };
    await broadcast.save();

    return broadcast;
  }

  async acknowledge(broadcastId, userId) {
    const broadcast = await EmergencyBroadcast.findById(broadcastId);
    if (!broadcast) throw new Error('Broadcast not found');

    const recipient = broadcast.recipients.find(r => r.userId.toString() === userId.toString());
    if (recipient) {
      recipient.status = 'acknowledged';
      recipient.acknowledgedAt = new Date();
      broadcast.deliveryStatus.acknowledged += 1;
      await broadcast.save();
    }
    return broadcast;
  }
}

module.exports = new EmergencyService();
