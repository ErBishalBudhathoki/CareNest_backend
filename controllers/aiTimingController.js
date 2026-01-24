const AiTimingService = require('../services/aiTimingService');
const CalendarService = require('../services/calendarService');

class AiTimingController {
  async getOptimalTime(req, res) {
    try {
      const { notification, userContext } = req.body;
      const userId = req.user.userId; // Assuming auth middleware sets this

      // Enrich user context with calendar data
      const calendarStatus = await CalendarService.getCurrentStatus(userId);
      const enrichedContext = { ...userContext, ...calendarStatus };

      const prediction = await AiTimingService.predictOptimalTime(notification, enrichedContext);

      res.json({
        success: true,
        data: prediction
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async recordFeedback(req, res) {
    try {
      const { notificationId, engaged, engagementType } = req.body;
      await AiTimingService.recordFeedback(notificationId, engaged, engagementType);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new AiTimingController();
