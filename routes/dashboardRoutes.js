const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const dashboardController = require('../controllers/dashboardController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, message: 'Too many dashboard requests.' }
});

// Common validation
const organizationIdValidation = [
  query('organizationId').isString().withMessage('Organization ID required')
];

// Apply authentication to all routes
router.use(authenticateUser);

/**
 * @route GET /api/dashboard/today-summary
 * @desc Get today's summary metrics
 * @access Private
 */
router.get(
  '/today-summary',
  dashboardLimiter,
  organizationIdValidation,
  handleValidationErrors,
  dashboardController.getTodaySummary
);

/**
 * @route GET /api/dashboard/worker-locations
 * @desc Get live worker locations
 * @access Private
 */
router.get(
  '/worker-locations',
  dashboardLimiter,
  organizationIdValidation,
  handleValidationErrors,
  dashboardController.getWorkerLocations
);

/**
 * @route GET /api/dashboard/quick-actions
 * @desc Get quick action items with counts
 * @access Private
 */
router.get(
  '/quick-actions',
  dashboardLimiter,
  organizationIdValidation,
  handleValidationErrors,
  dashboardController.getQuickActions
);

/**
 * @route GET /api/dashboard/compliance-alerts
 * @desc Get compliance alerts
 * @access Private
 */
router.get(
  '/compliance-alerts',
  dashboardLimiter,
  organizationIdValidation,
  handleValidationErrors,
  dashboardController.getComplianceAlerts
);

/**
 * @route GET /api/dashboard/revenue-comparison
 * @desc Get revenue comparison data
 * @access Private
 */
router.get(
  '/revenue-comparison',
  dashboardLimiter,
  organizationIdValidation,
  handleValidationErrors,
  dashboardController.getRevenueComparison
);

module.exports = router;
