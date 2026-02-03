const EmergencyService = require('../services/emergencyService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class EmergencyController {
  broadcast = catchAsync(async (req, res) => {
    const senderId = req.user.userId;
    const { teamId, message, priority } = req.body;
    
    if (!teamId || !message) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'teamId and message are required'
      });
    }
    
    const broadcast = await EmergencyService.sendBroadcast(senderId, teamId, message, priority);
    
    logger.business('Emergency broadcast sent', {
      action: 'emergency_broadcast',
      senderId,
      teamId,
      priority: priority || 'normal',
      messageLength: message.length
    });
    
    res.status(201).json({
      success: true,
      code: 'EMERGENCY_BROADCAST_SENT',
      data: broadcast,
      message: 'Emergency broadcast sent'
    });
  });

  acknowledge = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const { broadcastId } = req.params;
    
    if (!broadcastId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'broadcastId is required'
      });
    }
    
    const updatedBroadcast = await EmergencyService.acknowledge(broadcastId, userId);
    
    logger.business('Emergency broadcast acknowledged', {
      action: 'emergency_acknowledge',
      broadcastId,
      userId
    });
    
    res.status(200).json({
      success: true,
      code: 'EMERGENCY_ACKNOWLEDGED',
      data: updatedBroadcast
    });
  });
}

module.exports = new EmergencyController();
