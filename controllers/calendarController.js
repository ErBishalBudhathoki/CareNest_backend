const CalendarService = require('../services/calendarService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class CalendarController {
  sync = catchAsync(async (req, res) => {
    const { provider, accessToken } = req.body;
    const userId = req.user.userId;
    
    if (!provider || !accessToken) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Provider and accessToken are required'
      });
    }
    
    const result = await CalendarService.syncEvents(userId, provider, accessToken);
    
    logger.business('Calendar synced', {
      action: 'calendar_sync',
      userId,
      provider,
      pulled: result.pulled,
      pushed: result.pushed
    });
    
    res.status(200).json({
      success: true,
      code: 'CALENDAR_SYNCED',
      data: result.events,
      meta: {
        pulled: result.pulled,
        pushed: result.pushed
      },
      message: `Calendar synced successfully (Pulled: ${result.pulled}, Pushed: ${result.pushed})`
    });
  });

  getUpcoming = catchAsync(async (req, res) => {
    const userId = req.user.userId;
    const hours = parseInt(req.query.hours) || 24;
    
    const events = await CalendarService.getUpcomingEvents(userId, hours);
    
    logger.business('Retrieved upcoming calendar events', {
      action: 'calendar_upcoming',
      userId,
      hours,
      count: events?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'UPCOMING_EVENTS_RETRIEVED',
      data: events
    });
  });
}

module.exports = new CalendarController();
