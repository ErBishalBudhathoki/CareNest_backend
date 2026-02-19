const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');
const tripController = require('../controllers/tripController');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// Rate limiting
const tripReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many trip read requests.' }
});

const tripWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many trip write requests.' }
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
const createTripValidation = [
  body('date')
    .isISO8601()
    .withMessage('Date must be a valid ISO 8601 date'),
  body('startLocation')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Start location must be between 1 and 200 characters'),
  body('endLocation')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('End location must be between 1 and 200 characters'),
  body('distance')
    .isFloat({ min: 0 })
    .withMessage('Distance must be a positive number'),
  body('tripType')
    .isIn(['BETWEEN_CLIENTS', 'WITH_CLIENT', 'COMMUTE'])
    .withMessage('Trip type must be BETWEEN_CLIENTS, WITH_CLIENT, or COMMUTE'),
  body('clientId')
    .optional()
    .isMongoId()
    .withMessage('Client ID must be a valid MongoDB ObjectId')
];

const getAllTripsValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('status')
    .optional()
    .isIn(['PENDING', 'APPROVED', 'REJECTED'])
    .withMessage('Status must be PENDING, APPROVED, or REJECTED')
];

const getEmployeeTripsValidation = [
  param('userId')
    .isMongoId()
    .withMessage('User ID must be a valid MongoDB ObjectId'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('status')
    .optional()
    .isIn(['PENDING', 'APPROVED', 'REJECTED'])
    .withMessage('Status must be PENDING, APPROVED, or REJECTED')
];

const updateTripValidation = [
  param('tripId')
    .isMongoId()
    .withMessage('Trip ID must be a valid MongoDB ObjectId')
];

const updateTripStatusValidation = [
  param('tripId')
    .isMongoId()
    .withMessage('Trip ID must be a valid MongoDB ObjectId'),
  body('status')
    .isIn(['PENDING', 'APPROVED', 'REJECTED'])
    .withMessage('Status must be PENDING, APPROVED, or REJECTED')
];

const analyticsValidation = [
  query('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date')
];

// Create a trip
router.post(
  '/',
  authenticateUser,
  tripWriteLimiter,
  createTripValidation,
  handleValidationErrors,
  tripController.createTrip
);

// Get all trips (Admin only)
router.get(
  '/',
  authenticateUser,
  requireAdmin,
  tripReadLimiter,
  getAllTripsValidation,
  handleValidationErrors,
  tripController.getAllTrips
);

// Get Enhanced Invoice Analytics (Admin only)
router.get(
  '/analytics',
  authenticateUser,
  requireAdmin,
  tripReadLimiter,
  analyticsValidation,
  handleValidationErrors,
  tripController.getInvoiceAnalytics
);

// Update Trip Details (Admin only)
router.patch(
  '/:tripId',
  authenticateUser,
  requireAdmin,
  tripWriteLimiter,
  updateTripValidation,
  handleValidationErrors,
  tripController.updateTripDetails
);

// Approve/Reject Trip (Admin only)
router.patch(
  '/:tripId/status',
  authenticateUser,
  requireAdmin,
  tripWriteLimiter,
  updateTripStatusValidation,
  handleValidationErrors,
  tripController.updateTripStatus
);

// Get employee trips
router.get(
  '/employee/:userId',
  authenticateUser,
  tripReadLimiter,
  getEmployeeTripsValidation,
  handleValidationErrors,
  tripController.getTripsByEmployee
);

module.exports = router;
