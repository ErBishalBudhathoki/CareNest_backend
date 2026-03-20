const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
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

  /**
   * GET /api/emergency/active
   * Returns all active broadcasts for teams the current user belongs to.
   * Flutter TeamRepository calls this endpoint directly.
   */
  getActive = catchAsync(async (req, res) => {
    const userId = req.user.userId;

    // Find all teams the user is a member of
    const memberships = await TeamMember.find({ userId });
    const teamIds = memberships.map(m => m.teamId);

    const broadcasts = await EmergencyBroadcast.find({
      teamId: { $in: teamIds },
      status: 'active'
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: broadcasts });
  });

  /**
   * POST /api/emergency/acknowledge/:broadcastId
   * Alias that matches the Flutter client's endpoint path.
   */
  acknowledgeByParam = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const { broadcastId } = req.params;

    const broadcast = await EmergencyBroadcast.findByIdAndUpdate(
      broadcastId,
      { $addToSet: { acknowledgments: userId } },
      { new: true }
    );

    if (!broadcast) {
      return res.status(404).json({ success: false, message: 'Broadcast not found' });
    }

    res.json({ success: true, data: broadcast });
  });
}

module.exports = new EmergencyController();
