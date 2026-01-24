const TeamService = require('../services/teamService');

class TeamController {
  async create(req, res) {
    try {
      const managerId = req.user.userId;
      const { name, settings } = req.body;
      const team = await TeamService.createTeam(managerId, name, settings);
      res.status(201).json({ success: true, data: team });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getAvailability(req, res) {
    try {
      const { teamId } = req.params;
      const matrix = await TeamService.getAvailabilityMatrix(teamId);
      res.json({ success: true, data: matrix });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const userId = req.user.userId;
      const { teamId, status } = req.body;
      const member = await TeamService.updateAvailability(userId, teamId, status);
      res.json({ success: true, data: member });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new TeamController();
