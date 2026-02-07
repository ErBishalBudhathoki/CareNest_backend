const express = require('express');
const workedTimeController = require('../controllers/workedTimeController');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const { 
  organizationContextMiddleware, 
  requireOrganizationQueryMatch 
} = require('../middleware/organizationContext');

// Rate limiting
const historyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

// Validation rules
const visitHistoryValidation = [
  param('clientId').isMongoId().withMessage('Valid client ID is required'),
  query('organizationId').optional().isMongoId().withMessage('Invalid organization ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
];

const recentVisitsValidation = [
  param('userEmail').isEmail().normalizeEmail().withMessage('Valid email is required'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
];

// Protected routes
router.use(authenticateUser);
router.use(organizationContextMiddleware);

/**
 * Get visit history for a specific client
 * GET /history/:clientId
 */
router.get(
  '/history/:clientId', 
  historyLimiter, 
  requireOrganizationQueryMatch('organizationId'),
  visitHistoryValidation,
  handleValidationErrors,
  workedTimeController.getVisitHistory
);

/**
 * Get recent visits for a user
 * GET /recent/:userEmail
 */
router.get(
  '/recent/:userEmail', 
  historyLimiter, 
  requireOrganizationQueryMatch('organizationId'),
  recentVisitsValidation,
  handleValidationErrors,
  workedTimeController.getRecentVisits
);

const workedTimeValidation = [
  param('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
  param('clientEmail').isEmail().normalizeEmail().withMessage('Valid client email is required'),
  query('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

/**
 * Get worked time for user and client (Legacy/Compatibility endpoint)
 * GET /getWorkedTime/:userEmail/:clientEmail
 */
router.get(
  '/getWorkedTime/:userEmail/:clientEmail',
  historyLimiter,
  requireOrganizationQueryMatch('organizationId'),
  workedTimeValidation,
  handleValidationErrors,
  workedTimeController.getWorkedTime
);

module.exports = router;
