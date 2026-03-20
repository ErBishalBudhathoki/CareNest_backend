const workerService = require('../services/workerService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class WorkerController {
  _resolveRequestContext(req) {
    const orgId = req.headers['x-organization-id'] ||
      req.query.organizationId ||
      req.user?.organizationId;
    const userEmail = req.user?.email;
    return { orgId, userEmail };
  }

  /**
   * @route GET /api/worker/dashboard
   * @desc Get worker dashboard data (shifts, expenses, leave balances)
   * @access Private (Worker only)
   */
  getDashboard = catchAsync(async (req, res) => {
    const { orgId, userEmail } = this._resolveRequestContext(req);
    
    // Validation
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'User authentication required'
      });
    }
    
    if (!orgId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_ORGANIZATION_ID',
        message: 'Organization ID is required. Please provide it via header (x-organization-id) or ensure your account has a default organization.'
      });
    }

    // Log the request for audit purposes
    logger.info(`Worker dashboard requested by ${userEmail} for org ${orgId}`);

    // Fetch dashboard data from service
    const data = await workerService.getDashboardData(userEmail, orgId);

    // Success response with standardized format
    res.status(200).json({
      success: true,
      code: 'DASHBOARD_FETCHED',
      data
    });
  });

  /**
   * @route GET /api/worker/shift-history
   * @desc Get past assigned shift history for worker
   * @access Private (Worker only)
   */
  getShiftHistory = catchAsync(async (req, res) => {
    const { orgId, userEmail } = this._resolveRequestContext(req);

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'User authentication required'
      });
    }

    if (!orgId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_ORGANIZATION_ID',
        message: 'Organization ID is required. Please provide it via header (x-organization-id) or ensure your account has a default organization.'
      });
    }

    const daysParam = req.query.days;
    const limitParam = req.query.limit;
    const days = daysParam ? Number(daysParam) : null;
    const limit = limitParam ? Number(limitParam) : 200;

    logger.info(`Worker shift history requested by ${userEmail} for org ${orgId}`, {
      days,
      limit
    });

    const data = await workerService.getPastAssignedShiftHistory(userEmail, orgId, { days, limit });

    res.status(200).json({
      success: true,
      code: 'SHIFT_HISTORY_FETCHED',
      data
    });
  });
}

module.exports = new WorkerController();
