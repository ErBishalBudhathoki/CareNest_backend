const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const EmergencyService = require('../services/emergencyService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class EmergencyController {
  broadcast = catchAsync(async (req, res) => {
    const senderId = req.user.userId;
    const organizationId = req.user.organizationId;
    const { teamId, teamIds, message, type } = req.body;
    
    // Resolve targeted teams (support both legacy teamId and new teamIds array)
    let targets = teamIds;
    if (!targets && teamId) targets = [teamId];

    if (!targets || !Array.isArray(targets) || targets.length === 0 || !message || !type) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'teamIds (array), message, and type are required'
      });
    }
    
    let broadcast = await EmergencyService.sendBroadcast(senderId, targets, message, type, organizationId);
    
    // Populate initiator for immediate display in history
    broadcast = await EmergencyBroadcast.findById(broadcast._id)
      .populate('initiatorId', 'firstName lastName email');

    logger.business('Emergency broadcast sent', {
      action: 'emergency_broadcast',
      senderId,
      organizationId,
      teamIds: targets,
      type,
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
    const { userId, organizationId, roles } = req.user;
    const isAdmin = roles.includes('admin') || roles.includes('manager');

    let query;
    if (isAdmin && organizationId) {
      // Admins see all active broadcasts for the entire organization
      query = { organizationId, status: 'active' };
    } else {
      // Others only see active broadcasts for teams they belong to
      const memberships = await TeamMember.find({ userId });
      const teamIds = memberships.map(m => m.teamId);
      query = { 
        teamId: { $in: teamIds },
        status: 'active'
      };
    }

    const broadcasts = await EmergencyBroadcast.find(query).sort({ createdAt: -1 });

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

  /**
   * GET /api/emergency/history
   * Returns all broadcasts (active and inactive) for teams the current user belongs to.
   * Restricted to admin/manager via routes.
   */
  getHistory = catchAsync(async (req, res) => {
    const { userId, organizationId, roles } = req.user;
    const isAdmin = roles.includes('admin') || roles.includes('manager');

    let query;
    if (isAdmin && organizationId) {
      // Admins see all broadcasts for the entire organization
      query = { organizationId };
    } else {
      // Others only see broadcasts for teams they belong to
      const memberships = await TeamMember.find({ userId });
      const teamIds = memberships.map(m => m.teamId);
      query = { teamId: { $in: teamIds } };
    }

    const broadcasts = await EmergencyBroadcast.find(query)
      .populate('initiatorId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, data: broadcasts });
  });
}

module.exports = new EmergencyController();
