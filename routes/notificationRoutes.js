const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const NotificationController = require('../controllers/notificationController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const notificationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many notification read requests.' }
});

const notificationWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many notification write requests.' }
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

const { validationResult } = require('express-validator');

// Validation chains
const getHistoryValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('type').optional().isIn(['shift', 'geofence', 'expense', 'timesheet']).withMessage('Invalid notification type')
];

const markAsReadValidation = [
  param('id').isMongoId().withMessage('Invalid notification ID format')
];

// Apply authentication middleware to all routes
router.use(authenticateUser);

// Settings routes
router.get('/settings', notificationReadLimiter, NotificationController.getSettings);
router.put('/settings', notificationWriteLimiter, NotificationController.updateSettings);

// History routes
router.get('/history', notificationReadLimiter, getHistoryValidation, handleValidationErrors, NotificationController.getHistory);
router.put('/:id/read', notificationWriteLimiter, markAsReadValidation, handleValidationErrors, NotificationController.markAsRead);

module.exports = router;
