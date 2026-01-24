const CalendarEvent = require('../models/CalendarEvent');

class CalendarService {
  /**
   * Sync events from an external provider (Mocked)
   */
  async syncEvents(userId, _provider, _accessToken) {
    // Mock fetching from Google/Outlook
    const mockEvents = [
      {
        title: 'Deep Work',
        startTime: new Date(Date.now() + 3600000), // 1 hour from now
        endTime: new Date(Date.now() + 7200000),
        eventType: 'focus_time',
        isFocusTime: true
      },
      {
        title: 'Team Sync',
        startTime: new Date(Date.now() + 14400000), // 4 hours from now
        endTime: new Date(Date.now() + 18000000),
        eventType: 'meeting',
        isFocusTime: false
      }
    ];

    // Clear existing future events for sync
    await CalendarEvent.deleteMany({ 
      userId, 
      startTime: { $gt: new Date() } 
    });

    // Save new events
    const savedEvents = await CalendarEvent.insertMany(
      mockEvents.map(e => ({ ...e, userId }))
    );

    return savedEvents;
  }

  async getUpcomingEvents(userId, hours = 24) {
    const limitDate = new Date(Date.now() + hours * 3600000);
    return await CalendarEvent.find({
      userId,
      startTime: { $lt: limitDate, $gt: new Date() }
    }).sort({ startTime: 1 });
  }

  async getCurrentStatus(userId) {
    const now = new Date();
    const currentEvent = await CalendarEvent.findOne({
      userId,
      startTime: { $lte: now },
      endTime: { $gte: now }
    });

    if (currentEvent) {
      return {
        status: 'busy',
        activity: currentEvent.eventType,
        until: currentEvent.endTime
      };
    }

    return { status: 'free' };
  }
}

module.exports = new CalendarService();
