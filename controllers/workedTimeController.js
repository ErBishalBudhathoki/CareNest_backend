const workedTimeService = require('../services/workedTimeService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class WorkedTimeController {
  getVisitHistory = catchAsync(async (req, res) => {
    const { clientId } = req.params;
    const { organizationId, userEmail } = req.query;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Organization ID is required'
      });
    }

    const result = await workedTimeService.getVisitHistory(clientId, organizationId, userEmail);
    
    logger.business('Retrieved visit history', {
      action: 'worked_time_visit_history',
      clientId,
      organizationId,
      userEmail,
      recordCount: result.visits?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'VISIT_HISTORY_RETRIEVED',
      ...result
    });
  });

  getRecentVisits = catchAsync(async (req, res) => {
    const { userEmail } = req.params;
    const { limit } = req.query;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'userEmail is required'
      });
    }

    const result = await workedTimeService.getRecentVisits(userEmail, parseInt(limit) || 5);
    
    logger.business('Retrieved recent visits', {
      action: 'worked_time_recent_visits',
      userEmail,
      limit: parseInt(limit) || 5,
      recordCount: result.visits?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'RECENT_VISITS_RETRIEVED',
      ...result
    });
  });
  getWorkedTime = catchAsync(async (req, res) => {
    const { userEmail, clientEmail } = req.params;
    const { organizationId } = req.query;

    if (!userEmail || !clientEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'userEmail and clientEmail are required'
      });
    }

    const result = await workedTimeService.getWorkedTime(userEmail, clientEmail, organizationId);
    
    logger.business('Retrieved worked time details', {
      action: 'worked_time_details',
      userEmail,
      clientEmail,
      organizationId,
      recordCount: result.visits?.length || 0
    });
    
    // Legacy response format compatibility if needed
    // The frontend expects { workedTimes: [...] } or similar based on legacy code
    // api_method.dart:1285 expects 'workedTimes'
    
    res.status(200).json({
      success: true,
      code: 'WORKED_TIME_RETRIEVED',
      workedTimes: result.visits, // Mapping visits to workedTimes for frontend compatibility
      ...result
    });
  });
}

module.exports = new WorkedTimeController();
