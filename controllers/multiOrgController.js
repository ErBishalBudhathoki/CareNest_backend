const multiOrgService = require('../services/multiOrgService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class MultiOrgController {
  /**
   * Get multi-organization rollup stats
   * GET /api/multiorg/rollup
   */
  getRollup = catchAsync(async (req, res) => {
    const userEmail = req.user.email;
    const userId = req.user.id;

    const data = await multiOrgService.getRollupStats(userEmail);

    logger.business('Multi-Org Rollup Retrieved', {
      event: 'multiorg_rollup_retrieved',
      userId,
      userEmail,
      orgCount: data.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      code: 'ROLLUP_RETRIEVED',
      data
    });
  });
}

module.exports = new MultiOrgController();
