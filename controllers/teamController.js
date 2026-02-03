const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

class TeamController {
  // --- Teams ---

  create = catchAsync(async (req, res) => {
    const managerId = req.user.id;
    const { name, settings } = req.body;

    const team = await Team.create({
      name,
      managerId,
      settings: settings || {}
    });

    // Add manager as admin/manager member
    await TeamMember.create({
      teamId: team.id,
      userId: managerId,
      role: 'manager',
      status: 'active'
    });

    res.status(201).json({ success: true, data: team });
  });

  getMyTeams = catchAsync(async (req, res) => {
    const userId = req.user.id;
    
    // Find all memberships
    const memberships = await TeamMember.find({ userId }).populate('teamId');
    
    // Extract teams
    const teams = memberships
      .filter(m => m.teamId) // Ensure populated
      .map(m => m.teamId);

    // TODO: Ideally we should attach member role/status to the team object if needed by frontend
    // But frontend Team model has 'members' list.
    // For summary view, basic team info is enough.
    // We can populate members for each team if needed, but that's heavy.
    // Let's return teams. The frontend might fetch details later?
    // Frontend 'Team' model has 'members' list. 
    // I should populate members for each team.
    
    const populatedTeams = await Promise.all(teams.map(async (team) => {
        const members = await TeamMember.find({ teamId: team.id }).populate('userId', 'firstName lastName email profilePic'); // Adjusted populate fields
        const teamObj = team.toJSON();
        teamObj.members = members; // Attach members
        return teamObj;
    }));

    res.json({ success: true, data: populatedTeams });
  });

  inviteMember = catchAsync(async (req, res) => {
    const { teamId } = req.params;
    const { email, role } = req.body;
    
    // Find user by email (assuming User model has email)
    // Needs User model import if searching by email
    // For now, assuming we receive userId or skipping email lookup logic implementation details
    // I'll assume we need to look up User.
    const User = require('../models/User'); // Lazy import to avoid circular dep if any
    const user = await User.findOne({ email });
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if already member
    const existing = await TeamMember.findOne({ teamId, userId: user.id });
    if (existing) {
        return res.status(400).json({ success: false, message: 'User already in team' });
    }

    await TeamMember.create({
        teamId,
        userId: user.id,
        role: role || 'member',
        status: 'invited'
    });

    res.json({ success: true, message: 'Member invited' });
  });

  // --- Availability ---

  getAvailability = catchAsync(async (req, res) => {
    const { teamId } = req.params;
    const members = await TeamMember.find({ teamId }).populate('userId', 'firstName lastName email profilePic');
    
    const matrix = members.map(m => ({
      userId: m.userId ? m.userId.id : null,
      name: m.userId ? `${m.userId.firstName} ${m.userId.lastName}`.trim() : 'Unknown',
      status: m.availabilitySettings.status,
      role: m.role,
      profilePic: m.userId ? m.userId.profilePic : null
    }));
    
    res.json({ success: true, data: matrix });
  });

  updateStatus = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const { teamId, status } = req.body;
    
    const member = await TeamMember.findOneAndUpdate(
      { userId, teamId },
      { 'availabilitySettings.status': status },
      { new: true }
    );

    res.json({ success: true, data: member });
  });

  // --- Emergency ---

  sendBroadcast = catchAsync(async (req, res) => {
    const { teamId, message, type } = req.body;
    const initiatorId = req.user.id;

    const broadcast = await EmergencyBroadcast.create({
        teamId,
        initiatorId,
        message,
        type: type || 'alert', // 'medical', 'fire', etc.
        status: 'active'
    });

    // TODO: Trigger push notifications here via NotificationService

    res.status(201).json({ success: true, data: broadcast });
  });

  getActiveBroadcasts = catchAsync(async (req, res) => {
    const userId = req.user.id;
    // Find teams user belongs to
    const memberships = await TeamMember.find({ userId });
    const teamIds = memberships.map(m => m.teamId);

    const broadcasts = await EmergencyBroadcast.find({
        teamId: { $in: teamIds },
        status: 'active'
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: broadcasts });
  });

  acknowledgeBroadcast = catchAsync(async (req, res) => {
    const { id } = req.params; // broadcastId
    const userId = req.user.id;

    const broadcast = await EmergencyBroadcast.findByIdAndUpdate(
        id,
        { $addToSet: { acknowledgments: userId } }, // Add userId to acknowledgments array (simple schema)
        { new: true }
    );

    res.json({ success: true, data: broadcast });
  });
}

module.exports = new TeamController();
