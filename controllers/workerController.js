const workerService = require('../services/workerService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class WorkerController {
  /**
   * @route GET /api/worker/dashboard
   * @desc Get worker dashboard data (shifts, expenses, leave balances)
   * @access Private (Worker only)
   */
  getDashboard = catchAsync(async (req, res) => {
    // Organization ID should come from:
    // 1. Header (x-organization-id) - set by frontend or organizationContext middleware
    // 2. Query param (for backward compatibility)
    // 3. User's default organization (from req.user)
    const orgId = req.headers['x-organization-id'] || 
                  req.query.organizationId || 
                  req.user?.organizationId;
    
    // User email from authenticated user (set by auth middleware)
    const userEmail = req.user?.email;
    
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
}

module.exports = new WorkerController();
