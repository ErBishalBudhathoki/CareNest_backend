const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const AiTimingController = require('../controllers/aiTimingController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting configurations
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' }
});

const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many feedback requests.' }
});

// Validation rules
const optimalTimeValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('userId').optional().isMongoId().withMessage('Invalid user ID'),
  body('taskType').optional().trim().isLength({ max: 100 }),
  body('preferredDays').optional().isArray().withMessage('Preferred days must be an array'),
  body('preferredDays.*').optional().isIn([0, 1, 2, 3, 4, 5, 6]).withMessage('Day must be 0-6 (Sunday-Saturday)'),
  body('excludedTimes').optional().isArray(),
  body('duration').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer (minutes)')
];

const feedbackValidation = [
  body('suggestionId').isMongoId().withMessage('Valid suggestion ID is required'),
  body('wasHelpful').isBoolean().withMessage('wasHelpful must be a boolean'),
  body('actualTimeUsed').optional().isInt({ min: 1 }).withMessage('Actual time must be a positive integer (minutes)'),
  body('comments').optional().trim().isLength({ max: 1000 }).withMessage('Comments too long')
];

// Protected routes
router.use(authenticateUser);

router.post('/optimal-time', standardLimiter, optimalTimeValidation, handleValidationErrors, AiTimingController.getOptimalTime);
router.post('/feedback', feedbackLimiter, feedbackValidation, handleValidationErrors, AiTimingController.recordFeedback);

module.exports = router;
