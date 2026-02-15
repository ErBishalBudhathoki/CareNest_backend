const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const analyticsController = require('../controllers/analyticsController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many analytics requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Common validation chains
const dateRangeValidation = [
  query('startDate').isISO8601().toDate().withMessage('Valid startDate required'),
  query('endDate').isISO8601().toDate().withMessage('Valid endDate required'),
  query('organizationId').isString().withMessage('Organization ID required')
];

const weekStartValidation = [
  query('weekStart').isISO8601().withMessage('Valid weekStart date required (YYYY-MM-DD)'),
  query('organizationId').isString().withMessage('Organization ID required')
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

/**
 * @route GET /api/analytics/financials
 * @desc Get Labor Cost vs Revenue
 * @access Private
 */
router.get(
  '/financials',
  analyticsLimiter,
  authenticateUser,
  dateRangeValidation,
  handleValidationErrors,
  analyticsController.getFinancialMetrics
);

/**
 * @route GET /api/analytics/utilization
 * @desc Get Utilization Rates
 * @access Private
 */
router.get(
  '/utilization',
  analyticsLimiter,
  authenticateUser,
  dateRangeValidation,
  handleValidationErrors,
  analyticsController.getUtilizationMetrics
);

/**
 * @route GET /api/analytics/overtime
 * @desc Get Overtime Hotspots
 * @access Private
 */
router.get(
  '/overtime',
  analyticsLimiter,
  authenticateUser,
  weekStartValidation,
  handleValidationErrors,
  analyticsController.getOvertimeMetrics
);

/**
 * @route GET /api/analytics/reliability
 * @desc Get Reliability Metrics (No-Show, Fill Rate)
 * @access Private
 */
router.get(
  '/reliability',
  analyticsLimiter,
  authenticateUser,
  dateRangeValidation,
  handleValidationErrors,
  analyticsController.getReliabilityMetrics
);

/**
 * @route GET /api/analytics/cross-org/revenue
 * @desc Get Cross-Organization Revenue
 * @access Private (Owner/Cross-Org permission)
 */
router.get(
  '/cross-org/revenue',
  strictLimiter,
  authenticateUser,
  [
    query('startDate').isISO8601().toDate().withMessage('Valid startDate required'),
    query('endDate').isISO8601().toDate().withMessage('Valid endDate required')
  ],
  handleValidationErrors,
  analyticsController.getCrossOrgMetrics
);

/**
 * @route GET /api/analytics/forecast
 * @desc Get Revenue Forecast
 * @access Private
 */
router.get(
  '/forecast',
  analyticsLimiter,
  authenticateUser,
  [query('organizationId').isString().withMessage('Organization ID required')],
  handleValidationErrors,
  analyticsController.getRevenueForecast
);

/**
 * @route GET /api/analytics/pricing/:organizationId
 * @desc Get Pricing Analytics
 * @access Private
 */
router.get(
  '/pricing/:organizationId',
  analyticsLimiter,
  authenticateUser,
  organizationIdValidation,
  [
    query('startDate').optional().isISO8601().withMessage('Valid startDate required'),
    query('endDate').optional().isISO8601().withMessage('Valid endDate required'),
    query('clientId').optional().isMongoId().withMessage('Valid clientId required')
  ],
  handleValidationErrors,
  analyticsController.getPricingAnalytics
);

/**
 * @route GET /api/analytics/pricing/compliance/:organizationId
 * @desc Get Pricing Compliance Report
 * @access Private
 */
router.get(
  '/pricing/compliance/:organizationId',
  analyticsLimiter,
  authenticateUser,
  organizationIdValidation,
  [
    query('startDate').optional().isISO8601().withMessage('Valid startDate required'),
    query('endDate').optional().isISO8601().withMessage('Valid endDate required'),
    query('threshold').optional().isFloat({ min: 0, max: 1 }).withMessage('Threshold must be between 0 and 1')
  ],
  handleValidationErrors,
  analyticsController.getPricingComplianceReport
);

/**
 * @route GET /api/analytics/churn-prediction
 * @desc Get Worker Churn Predictions
 * @access Private
 */
router.get(
  '/churn-prediction',
  analyticsLimiter,
  authenticateUser,
  [query('organizationId').isString().withMessage('Organization ID required')],
  handleValidationErrors,
  analyticsController.getChurnPrediction
);

/**
 * @route GET /api/analytics/demand-forecast
 * @desc Get Demand Forecast
 * @access Private
 */
router.get(
  '/demand-forecast',
  analyticsLimiter,
  authenticateUser,
  [
    query('organizationId').isString().withMessage('Organization ID required'),
    query('daysAhead').optional().isInt({ min: 1, max: 90 }).withMessage('Days ahead must be between 1 and 90')
  ],
  handleValidationErrors,
  analyticsController.getDemandForecast
);

/**
 * @route GET /api/analytics/compliance-risk
 * @desc Get Compliance Risk Assessment
 * @access Private
 */
router.get(
  '/compliance-risk',
  analyticsLimiter,
  authenticateUser,
  [query('organizationId').isString().withMessage('Organization ID required')],
  handleValidationErrors,
  analyticsController.getComplianceRisk
);

/**
 * @route GET /api/analytics/client-risk
 * @desc Get Client Risk Predictions
 * @access Private
 */
router.get(
  '/client-risk',
  analyticsLimiter,
  authenticateUser,
  [query('organizationId').isString().withMessage('Organization ID required')],
  handleValidationErrors,
  analyticsController.getClientRisk
);

/**
 * @route GET /api/analytics/service-demand
 * @desc Get Service Demand Predictions
 * @access Private
 */
router.get(
  '/service-demand',
  analyticsLimiter,
  authenticateUser,
  [
    query('organizationId').isString().withMessage('Organization ID required'),
    query('daysAhead').optional().isInt({ min: 1, max: 90 }).withMessage('Days ahead must be between 1 and 90')
  ],
  handleValidationErrors,
  analyticsController.getServiceDemand
);

/**
 * @route POST /api/analytics/scenario-model
 * @desc Run Scenario Model
 * @access Private
 */
router.post(
  '/scenario-model',
  analyticsLimiter,
  authenticateUser,
  [
    body('organizationId').isString().withMessage('Organization ID required'),
    body('scenario').isObject().withMessage('Scenario parameters required')
  ],
  handleValidationErrors,
  analyticsController.runScenarioModel
);

/**
 * @route GET /api/analytics/recommendations
 * @desc Get AI Recommendations
 * @access Private
 */
router.get(
  '/recommendations',
  analyticsLimiter,
  authenticateUser,
  [query('organizationId').isString().withMessage('Organization ID required')],
  handleValidationErrors,
  analyticsController.getRecommendations
);

module.exports = router;
