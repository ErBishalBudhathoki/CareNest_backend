/**
 * Active Timers Routes
 * Express router for active timer management
 * 
 * @file backend/routes/v1/activeTimers.js
 */

const express = require('express');
const ActiveTimerController = require('../../controllers/activeTimerController');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth');
const { requireEntitlement } = require('../../middleware/billing/requireEntitlement');

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Rate limiting
const timerLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  message: { success: false, message: 'Too many timer requests.' }
});

// Validation
const startValidation = [
  body('userEmail').isEmail().withMessage('Valid userEmail is required'),
  body('clientEmail').isEmail().withMessage('Valid clientEmail is required'),
  body('organizationId').notEmpty().withMessage('organizationId is required')
];

const stopValidation = [
  body('userEmail').isEmail().withMessage('Valid userEmail is required'),
  body('organizationId').notEmpty().withMessage('organizationId is required')
];

// Protected routes
router.use(authenticateUser);

// Start a timer (clock in)
router.post('/start', timerLimiter, requireEntitlement('clock_in'), startValidation, handleValidationErrors, ActiveTimerController.startTimer);

// Stop a timer (clock out)
router.post('/stop', timerLimiter, requireEntitlement('clock_out'), stopValidation, handleValidationErrors, ActiveTimerController.stopTimer);

// Get active timers for an organization
// GET /active-timers/:organizationId
router.get('/:organizationId', timerLimiter, param('organizationId').isMongoId(), handleValidationErrors, ActiveTimerController.getActiveTimers);

module.exports = router;
