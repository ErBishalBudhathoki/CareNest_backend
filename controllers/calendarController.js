const CalendarService = require('../services/calendarService');

class CalendarController {
  async sync(req, res) {
    try {
      const { provider, accessToken } = req.body;
      const userId = req.user.userId;
      
      const result = await CalendarService.syncEvents(userId, provider, accessToken);
      
      res.json({
        success: true,
        data: result.events,
        meta: {
          pulled: result.pulled,
          pushed: result.pushed
        },
        message: `Calendar synced successfully (Pulled: ${result.pulled}, Pushed: ${result.pushed})`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getUpcoming(req, res) {
    try {
      const userId = req.user.userId;
      const hours = parseInt(req.query.hours) || 24;
      
      const events = await CalendarService.getUpcomingEvents(userId, hours);
      
      res.json({
        success: true,
        data: events
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new CalendarController();
