const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const complianceController = require('../controllers/complianceController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const complianceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many compliance requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const summaryValidation = [
  query('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('includeExpired').optional().isBoolean().withMessage('includeExpired must be boolean')
];

// Protected routes
router.use(authenticateUser);

/**
 * Get compliance summary
 * GET /api/compliance/summary
 */
router.get('/summary', complianceLimiter, summaryValidation, handleValidationErrors, complianceController.getSummary);

module.exports = router;
