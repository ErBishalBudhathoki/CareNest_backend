const EmergencyService = require('../services/emergencyService');

class EmergencyController {
  async broadcast(req, res) {
    try {
      const senderId = req.user.userId;
      const { teamId, message, priority } = req.body;
      
      const broadcast = await EmergencyService.sendBroadcast(senderId, teamId, message, priority);
      
      res.status(201).json({
        success: true,
        data: broadcast,
        message: 'Emergency broadcast sent'
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async acknowledge(req, res) {
    try {
      const userId = req.user.userId;
      const { broadcastId } = req.params;
      
      const updatedBroadcast = await EmergencyService.acknowledge(broadcastId, userId);
      
      res.json({
        success: true,
        data: updatedBroadcast
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new EmergencyController();
