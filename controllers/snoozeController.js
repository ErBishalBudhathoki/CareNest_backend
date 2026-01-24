const SnoozeService = require('../services/snoozeService');

class SnoozeController {
  async createRule(req, res) {
    try {
      const userId = req.user.userId;
      const rule = await SnoozeService.createRule(userId, req.body);
      res.status(201).json({
        success: true,
        data: rule
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getRules(req, res) {
    try {
      const userId = req.user.userId;
      const rules = await SnoozeService.getRules(userId);
      res.json({
        success: true,
        data: rules
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async checkSnooze(req, res) {
    try {
      const userId = req.user.userId;
      const { notification } = req.body;
      const result = await SnoozeService.evaluateSnooze(userId, notification);
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new SnoozeController();
