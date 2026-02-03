const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { param, query, body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const earningsController = require('../controllers/earningsController');
const { authenticateUser } = require('../middleware/auth');
const {
  requireAdmin,
  requireSelfOrAdmin,
} = require('../middleware/rbac');

// Rate limiting
const earningsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many earnings requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const emailParamValidation = [
  param('userEmail').isEmail().normalizeEmail().withMessage('Invalid email format')
];

const historyValidation = [
  ...emailParamValidation,
  query('startDate').optional().isISO8601().toDate().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().toDate().withMessage('Invalid end date'),
  query('bucket').optional().isIn(['week', 'month', 'year']).withMessage('Bucket must be week, month, or year')
];

const payRateValidation = [
  ...emailParamValidation,
  body('rate').isFloat({ min: 0 }).withMessage('Rate must be a positive number'),
  body('rateType').optional().isIn(['hourly', 'salary', 'contract']).withMessage('Rate type must be hourly, salary, or contract'),
  body('effectiveDate').optional().isISO8601().withMessage('Invalid effective date')
];

// Get earnings summary
router.get(
  '/summary/:userEmail',
  earningsLimiter,
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  emailParamValidation,
  handleValidationErrors,
  earningsController.getEarningsSummary
);

// Get projected earnings
router.get(
  '/projected/:userEmail',
  earningsLimiter,
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  emailParamValidation,
  handleValidationErrors,
  earningsController.getProjectedEarnings
);

// Get earnings history
router.get(
  '/history/:userEmail',
  earningsLimiter,
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  historyValidation,
  handleValidationErrors,
  earningsController.getEarningsHistory
);

// Set pay rate (Admin)
router.post(
  '/rate/:userEmail',
  strictLimiter,
  authenticateUser,
  requireAdmin,
  payRateValidation,
  handleValidationErrors,
  earningsController.setPayRate
);

// Get Quarterly OTE for Super Cap
router.get(
  '/quarterly-ote/:userEmail',
  earningsLimiter,
  authenticateUser,
  requireSelfOrAdmin('userEmail'),
  emailParamValidation,
  handleValidationErrors,
  earningsController.getQuarterlyOTE
);

module.exports = router;
