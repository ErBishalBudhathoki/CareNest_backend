const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const TeamMember = require('../models/TeamMember');
const EmergencyService = require('../services/emergencyService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const mongoose = require('mongoose');

class EmergencyController {
  broadcast = catchAsync(async (req, res) => {
    // Ensure senderId is a clean string (guards against jwt middleware returning object)
    const senderId = String(req.user.userId || req.user.id || '');
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
    
    // Populate initiator for display; extract safe fields to avoid [object Object] serialisation
    const populated = await EmergencyBroadcast.findById(broadcast._id)
      .populate('initiatorId', 'firstName lastName email');

    // Build a clean response object
    const broadcastData = populated.toJSON();
    if (populated.initiatorId && typeof populated.initiatorId === 'object' && populated.initiatorId._id) {
      broadcastData.initiator = {
        id: populated.initiatorId._id.toString(),
        firstName: populated.initiatorId.firstName,
        lastName: populated.initiatorId.lastName,
        email: populated.initiatorId.email,
      };
      broadcastData.initiatorId = populated.initiatorId._id.toString();
    }

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
      data: broadcastData,
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
    const isAdmin = Array.isArray(roles)
      ? roles.some(r => ['admin', 'manager'].includes(String(r).toLowerCase()))
      : false;

    let query;
    if (isAdmin && organizationId) {
      // Admins see all active broadcasts for the entire organization
      query = { organizationId, status: 'active' };
    } else {
      // Safely cast string userId from JWT to ObjectId for TeamMember lookup
      let userObjectId;
      try {
        userObjectId = new mongoose.Types.ObjectId(String(userId));
      } catch (_) {
        return res.json({ success: true, data: [] });
      }

      // Find all teams this employee belongs to
      const memberships = await TeamMember.find({ userId: userObjectId });
      const memberTeamIds = memberships.map(m => m.teamId);

      if (memberTeamIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      // Match broadcasts where ANY of the targeted teamIds overlaps with the user's teams.
      // Checks both `teamIds` (array field) and legacy `teamId` (singular) for full coverage.
      query = {
        status: 'active',
        $or: [
          { teamIds: { $in: memberTeamIds } },
          { teamId:  { $in: memberTeamIds } },
        ],
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
