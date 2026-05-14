const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const EmergencyBroadcast = require('../models/EmergencyBroadcast');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');

class TeamController {
  // --- Teams ---

  create = catchAsync(async (req, res) => {
    const managerId = req.user.userId;
    const organizationId = req.user.organizationId;
    const { name, settings } = req.body;

    const team = await Team.create({
      name,
      managerId,
      organizationId,
      settings: settings || {}
    });

    // Add manager as active member with manager role
    await TeamMember.create({
      teamId: team._id,
      userId: managerId,
      role: 'manager',
      status: 'active'
    });

    res.status(201).json({ success: true, data: team });
  });

  update = catchAsync(async (req, res) => {
    const { teamId } = req.params;
    const { name, settings } = req.body;

    const team = await Team.findByIdAndUpdate(
      teamId,
      { name, settings },
      { new: true }
    );

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ success: true, data: team });
  });

  delete = catchAsync(async (req, res) => {
    const { teamId } = req.params;

    const team = await Team.findByIdAndUpdate(
      teamId,
      { status: 'deleted' },
      { new: true }
    );

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Also deactivate memberships
    await TeamMember.updateMany({ teamId }, { status: 'deactivated' });

    res.json({ success: true, message: 'Team deleted' });
  });

  squash = catchAsync(async (req, res) => {
    const { teamId } = req.params;

    const team = await Team.findByIdAndUpdate(
      teamId,
      { status: 'archived' },
      { new: true }
    );

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ success: true, message: 'Team archived', data: team });
  });

  getMyTeams = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    
    // Find all memberships
    const memberships = await TeamMember.find({ userId }).populate('teamId');
    
    // Extract teams
    const teams = memberships
      .filter(m => m.teamId) // Ensure populated
      .map(m => m.teamId);

    const populatedTeams = await Promise.all(teams.map(async (teamDoc) => {
        const teamId = teamDoc._id || teamDoc.id;
        const members = await TeamMember.find({ teamId }).populate('userId', 'firstName lastName email profilePic');
        const teamObj = teamDoc.toJSON();
        teamObj.members = members;
        return teamObj;
    }));

    res.json({ success: true, data: populatedTeams });
  });

  inviteMember = catchAsync(async (req, res) => {
    const { teamId } = req.params;
    const { email, role } = req.body;
    
    const User = require('../models/User');
    const user = await User.findOne({ email });
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if already member
    const targetUserId = user._id || user.id;
    const existing = await TeamMember.findOne({ teamId, userId: targetUserId });
    if (existing) {
        return res.status(400).json({ success: false, message: 'User already in team' });
    }

    await TeamMember.create({
        teamId,
        userId: targetUserId,
        role: role || 'member',
        status: 'invited'
    });

    res.json({ success: true, message: 'Member invited' });
  });

  // --- Availability ---

  getAvailability = catchAsync(async (req, res) => {
    const { teamId } = req.params;
    const members = await TeamMember.find({ teamId }).populate('userId', 'firstName lastName email profilePic');
    
    const matrix = members.map(m => {
      const u = m.userId;
      const uid = u ? (u._id || u.id) : null;
      return {
        userId: uid,
        name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Unknown',
        status: m.availabilitySettings ? (m.availabilitySettings.status || 'available') : 'available',
        role: m.role,
        profilePic: u ? u.profilePic : null
      };
    });
    
    res.json({ success: true, data: matrix });
  });

  updateStatus = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const { teamId, status } = req.body;
    
    const member = await TeamMember.findOneAndUpdate(
      { userId, teamId },
      { 'availabilitySettings.status': status },
      { new: true }
    );

    res.json({ success: true, data: member });
  });

  // --- Emergency ---

}

module.exports = new TeamController();
