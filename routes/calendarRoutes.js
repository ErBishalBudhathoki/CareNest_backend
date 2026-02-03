const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const CalendarController = require('../controllers/calendarController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const calendarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many calendar requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const syncValidation = [
  body('provider').isIn(['google', 'outlook', 'apple']).withMessage('Valid calendar provider is required'),
  body('accessToken').trim().notEmpty().withMessage('Access token is required'),
  body('refreshToken').optional().trim(),
  body('calendarId').optional().trim().isLength({ max: 255 }),
  body('syncFrom').optional().isISO8601().withMessage('Invalid sync from date'),
  body('syncTo').optional().isISO8601().withMessage('Invalid sync to date')
];

const upcomingValidation = [
  query('days').optional().isInt({ min: 1, max: 90 }).withMessage('Days must be between 1 and 90'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date')
];

// Protected routes
router.use(authenticateUser);

router.post('/sync', strictLimiter, syncValidation, handleValidationErrors, CalendarController.sync);
router.get('/upcoming', calendarLimiter, upcomingValidation, handleValidationErrors, CalendarController.getUpcoming);

module.exports = router;
