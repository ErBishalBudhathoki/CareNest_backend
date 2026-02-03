const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const SnoozeService = require('../services/snoozeService');

class SnoozeController {
  createRule = catchAsync(async (req, res) => {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'User authentication required'
      });
    }

    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Rule data is required'
      });
    }

    const rule = await SnoozeService.createRule(userId, req.body);

    logger.business('Snooze rule created', {
      action: 'SNOOZE_RULE_CREATED',
      userId,
      ruleId: rule?.id || rule?._id
    });

    res.status(201).json({
      success: true,
      code: 'SNOOZE_RULE_CREATED',
      data: rule
    });
  });

  getRules = catchAsync(async (req, res) => {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'User authentication required'
      });
    }

    const rules = await SnoozeService.getRules(userId);

    logger.business('Snooze rules retrieved', {
      action: 'SNOOZE_RULES_RETRIEVED',
      userId,
      ruleCount: rules?.length || 0
    });

    res.status(200).json({
      success: true,
      code: 'SNOOZE_RULES_RETRIEVED',
      data: rules
    });
  });

  checkSnooze = catchAsync(async (req, res) => {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'User authentication required'
      });
    }

    const { notification } = req.body;

    if (!notification) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Notification data is required'
      });
    }

    const result = await SnoozeService.evaluateSnooze(userId, notification);

    logger.business('Snooze check performed', {
      action: 'SNOOZE_CHECKED',
      userId,
      isSnoozed: result?.isSnoozed
    });

    res.status(200).json({
      success: true,
      code: 'SNOOZE_CHECKED',
      data: result
    });
  });
}

module.exports = new SnoozeController();
