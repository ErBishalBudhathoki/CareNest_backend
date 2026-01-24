const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');

class TeamService {
  async createTeam(managerId, name, settings) {
    const team = await Team.create({
      name,
      managerId,
      settings
    });

    // Add manager as admin member
    await TeamMember.create({
      teamId: team._id,
      userId: managerId,
      role: 'manager'
    });

    return team;
  }

  async getTeamMembers(teamId) {
    return await TeamMember.find({ teamId }).populate('userId', 'name email');
  }

  async updateAvailability(userId, teamId, status) {
    return await TeamMember.findOneAndUpdate(
      { userId, teamId },
      { 'availabilitySettings.status': status },
      { new: true }
    );
  }

  async getAvailabilityMatrix(teamId) {
    const members = await this.getTeamMembers(teamId);
    return members.map(m => ({
      userId: m.userId._id,
      name: m.userId.name,
      status: m.availabilitySettings.status,
      role: m.role
    }));
  }
}

module.exports = new TeamService();
