const { processRecurringCharges } = require('../../services/billing/recurringChargeService');
const catchAsync = require('../../utils/catchAsync');
const logger = require('../../config/logger');

class RecurringChargeController {
  /**
   * POST /api/billing/recurring/run
   * Internal use by the scheduler; requires an organization admin to be
   * the one requesting the run. The scheduler route (cron) is separate.
   */
  run = catchAsync(async (req, res) => {
    const result = await processRecurringCharges();
    logger.info('Manual recurring charge run completed', result);
    res.json({
      success: true,
      code: 'RECURRING_CHARGES_PROCESSED',
      ...result,
    });
  });
}

module.exports = new RecurringChargeController();
