const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payrollController');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const { query, param, body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Rate limiters
const payrollReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many payroll requests. Please try again later.'
  }
});

const payrollExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 export requests per window
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many payroll export requests. Please try again later.'
  }
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.param, message: e.msg }))
    });
  }
  next();
};

// Date validation regex (YYYY-MM-DD format)
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Validation chains
const getSummaryValidation = [
  query('startDate')
    .matches(dateRegex).withMessage('StartDate must be in YYYY-MM-DD format')
    .isISO8601().withMessage('StartDate must be a valid date'),
  query('endDate')
    .matches(dateRegex).withMessage('EndDate must be in YYYY-MM-DD format')
    .isISO8601().withMessage('EndDate must be a valid date')
];

const exportPayrollValidation = [
  param('format')
    .isIn(['json', 'csv']).withMessage('Format must be either json or csv'),
  body('startDate')
    .matches(dateRegex).withMessage('StartDate must be in YYYY-MM-DD format')
    .isISO8601().withMessage('StartDate must be a valid date'),
  body('endDate')
    .matches(dateRegex).withMessage('EndDate must be in YYYY-MM-DD format')
    .isISO8601().withMessage('EndDate must be a valid date')
];

// All payroll routes require Admin access
// In future, might allow 'Payroll Officer' role

// Get Payroll Summary
// GET /api/payroll/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get(
  '/summary',
  authenticateUser,
  requireAdmin,
  payrollReadLimiter,
  getSummaryValidation,
  handleValidationErrors,
  payrollController.getSummary
);

// Export Payroll Data
// POST /api/payroll/export/:format
router.post(
  '/export/:format',
  authenticateUser,
  requireAdmin,
  payrollExportLimiter,
  exportPayrollValidation,
  handleValidationErrors,
  payrollController.exportPayroll
);

module.exports = router;
