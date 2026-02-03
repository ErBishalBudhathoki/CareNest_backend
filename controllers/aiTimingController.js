const AiTimingService = require('../services/aiTimingService');
const CalendarService = require('../services/calendarService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class AiTimingController {
  getOptimalTime = catchAsync(async (req, res) => {
    const { notification, userContext } = req.body;
    const userId = req.user.userId;
    
    if (!notification) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Notification data is required'
      });
    }

    // Enrich user context with calendar data
    const calendarStatus = await CalendarService.getCurrentStatus(userId);
    const enrichedContext = { ...userContext, ...calendarStatus };

    const prediction = await AiTimingService.predictOptimalTime(notification, enrichedContext);
    
    logger.business('AI optimal time calculated', {
      action: 'ai_optimal_time',
      userId,
      notificationType: notification.type
    });

    res.status(200).json({
      success: true,
      code: 'OPTIMAL_TIME_CALCULATED',
      data: prediction
    });
  });

  recordFeedback = catchAsync(async (req, res) => {
    const { notificationId, engaged, engagementType } = req.body;
    
    if (!notificationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'notificationId is required'
      });
    }
    
    await AiTimingService.recordFeedback(notificationId, engaged, engagementType);
    
    logger.business('AI timing feedback recorded', {
      action: 'ai_feedback_record',
      notificationId,
      engaged,
      engagementType
    });
    
    res.status(200).json({
      success: true,
      code: 'FEEDBACK_RECORDED'
    });
  });
}

module.exports = new AiTimingController();
