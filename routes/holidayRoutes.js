const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');
const holidayController = require('../controllers/holidayController');
const { authenticateUser, requireAdmin } = require('../middleware/auth');

// Rate limiting
const holidayReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many holiday read requests.' }
});

const holidayWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many holiday write requests.' }
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

// Validation chains
const getHolidaysValidation = [
  query('organizationId')
    .optional()
    .isString()
    .withMessage('Organization ID must be a string')
];

const addHolidayValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Holiday name is required and must be less than 100 characters'),
  body('date')
    .trim()
    .notEmpty()
    .withMessage('Date is required'),
  body('day')
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('Day is required (e.g., Monday, Tuesday)'),
  body('organizationId')
    .optional()
    .isString()
    .withMessage('Organization ID must be a string'),
  body('state')
    .optional()
    .isLength({ min: 2, max: 3 })
    .withMessage('State must be 2-3 characters (e.g., NSW, VIC)')
];

const deleteHolidayValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid holiday ID format')
];

const checkHolidaysValidation = [
  body('dates')
    .isArray({ min: 1 })
    .withMessage('dates must be a non-empty array'),
  body('dates.*')
    .isString()
    .withMessage('Each date must be a string')
];

// Public routes (read-only)
router.get(
  '/',
  holidayReadLimiter,
  getHolidaysValidation,
  handleValidationErrors,
  holidayController.getAllHolidays
);

router.post(
  '/check',
  holidayReadLimiter,
  checkHolidaysValidation,
  handleValidationErrors,
  holidayController.checkHolidays
);

// Admin-only routes
router.post(
  '/upload-csv',
  authenticateUser,
  requireAdmin,
  holidayWriteLimiter,
  holidayController.uploadCSV
);

router.post(
  '/',
  authenticateUser,
  requireAdmin,
  holidayWriteLimiter,
  addHolidayValidation,
  handleValidationErrors,
  holidayController.addHoliday
);

router.delete(
  '/:id',
  authenticateUser,
  requireAdmin,
  holidayWriteLimiter,
  deleteHolidayValidation,
  handleValidationErrors,
  holidayController.deleteHoliday
);

module.exports = router;
