const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');
const leaveController = require('../controllers/leaveController');
const { authenticateUser, requireRoles } = require('../middleware/auth');

// Rate limiting
const leaveReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many leave read requests.' }
});

const leaveWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many leave write requests.' }
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

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validation chains
const getBalancesValidation = [
  param('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required')
];

const submitRequestValidation = [
  body('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  body('leaveType')
    .isIn(['annual', 'sick', 'personal', 'longService'])
    .withMessage('Leave type must be annual, sick, personal, or longService'),
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  body('reason')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Reason must be between 1 and 500 characters'),
  body('totalHours')
    .isFloat({ min: 0.1, max: 168 })
    .withMessage('Total hours must be between 0.1 and 168')
];

const getRequestsValidation = [
  param('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required')
];

const getForecastValidation = [
  param('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  query('targetDate')
    .isISO8601()
    .withMessage('Target date must be a valid ISO 8601 date')
];

const getHolidaysValidation = [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('Year must be between 2000 and 2100')
];

/**
 * @route GET /api/leave/balances/:userEmail
 * @desc Get leave balances for a user
 * @access Private
 */
router.get(
  '/balances/:userEmail',
  authenticateUser,
  leaveReadLimiter,
  getBalancesValidation,
  handleValidationErrors,
  leaveController.getLeaveBalances
);

/**
 * @route POST /api/leave/request
 * @desc Submit a new leave request
 * @access Private
 */
router.post(
  '/request',
  authenticateUser,
  leaveWriteLimiter,
  submitRequestValidation,
  handleValidationErrors,
  leaveController.submitLeaveRequest
);

/**
 * @route GET /api/leave/requests/:userEmail
 * @desc Get leave requests for a user
 * @access Private
 */
router.get(
  '/requests/:userEmail',
  authenticateUser,
  leaveReadLimiter,
  getRequestsValidation,
  handleValidationErrors,
  leaveController.getLeaveRequests
);

/**
 * @route GET /api/leave/forecast/:userEmail
 * @desc Calculate leave forecast
 * @access Private
 */
router.get(
  '/forecast/:userEmail',
  authenticateUser,
  leaveReadLimiter,
  getForecastValidation,
  handleValidationErrors,
  leaveController.getLeaveForecast
);

/**
 * @route GET /api/leave/public-holidays
 * @desc Get public holidays
 * @access Private
 */
router.get(
  '/public-holidays',
  authenticateUser,
  leaveReadLimiter,
  getHolidaysValidation,
  handleValidationErrors,
  leaveController.getPublicHolidays
);

/**
 * @route PUT /api/leave/request/:requestId/status
 * @desc Approve or reject a leave request
 * @access Private (Admin/Superadmin)
 */
router.put(
  '/request/:requestId/status',
  authenticateUser,
  requireRoles(['admin', 'superadmin']),
  leaveWriteLimiter,
  param('requestId').isMongoId().withMessage('Invalid request ID format'),
  body('status').isIn(['Approved', 'Rejected']).withMessage('Status must be Approved or Rejected'),
  handleValidationErrors,
  (req, res) => {
    res.status(501).json({ success: false, message: 'Approval endpoint not yet fully integrated with leaveController' });
  }
);

/**
 * @route PUT /api/leave/balances/:userEmail
 * @desc Update leave balance for a user (Admin only)
 * @access Private (Admin/Superadmin)
 */
router.put(
  '/balances/:userEmail',
  authenticateUser,
  requireRoles(['admin', 'superadmin']),
  leaveWriteLimiter,
  getBalancesValidation,
  body('leaveType').notEmpty(),
  body('hours').isFloat(),
  body('reason').notEmpty(),
  handleValidationErrors,
  leaveController.updateLeaveBalance
);

module.exports = router;
