const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateUser } = require('../middleware/auth');
const { requireOrganizationMatch } = require('../middleware/rbac');

/**
 * @route GET /api/analytics/financials
 * @desc Get Labor Cost vs Revenue
 * @access Private
 */
router.get(
  '/financials',
  authenticateUser,
  // requireOrganizationMatch, // Optional: if we want to strictly enforce org match
  analyticsController.getFinancialMetrics
);

/**
 * @route GET /api/analytics/utilization
 * @desc Get Utilization Rates
 * @access Private
 */
router.get(
  '/utilization',
  authenticateUser,
  analyticsController.getUtilizationMetrics
);

/**
 * @route GET /api/analytics/overtime
 * @desc Get Overtime Hotspots
 * @access Private
 */
router.get(
  '/overtime',
  authenticateUser,
  analyticsController.getOvertimeMetrics
);

/**
 * @route GET /api/analytics/reliability
 * @desc Get Reliability Metrics (No-Show, Fill Rate)
 * @access Private
 */
router.get(
  '/reliability',
  authenticateUser,
  analyticsController.getReliabilityMetrics
);

module.exports = router;
