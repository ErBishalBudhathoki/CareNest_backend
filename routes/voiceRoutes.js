const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const VoiceController = require('../controllers/voiceController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting for voice endpoints
const voiceRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many voice commands. Please try again later.'
  }
});

// Validation chains
const commandValidation = [
  body('audioData').optional().isString().withMessage('Audio data must be a string'),
  body('audioData').optional().isLength({ max: 10000000 }).withMessage('Audio data too large'),
  body('commandText').optional().isString().trim().isLength({ max: 1000 }).withMessage('Command text too long'),
  body('language').optional().isString().isLength({ min: 2, max: 10 }).withMessage('Invalid language code'),
  body('context').optional().isObject().withMessage('Context must be an object'),
  // Custom validator to ensure at least one of audioData or commandText is present
  body().custom((value, { req }) => {
    if (!req.body.audioData && !req.body.commandText) {
      throw new Error('Either audioData or commandText is required');
    }
    return true;
  })
];

const historyValidation = [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt().withMessage('Limit must be between 1 and 100'),
  query('page').optional().isInt({ min: 1 }).toInt().withMessage('Page must be a positive integer')
];

// Routes
router.use(authenticateUser);

/**
 * @route POST /api/voice/command
 * @desc Process a voice command
 */
router.post(
  '/command',
  voiceRateLimit,
  commandValidation,
  handleValidationErrors,
  VoiceController.processCommand
);

/**
 * @route GET /api/voice/history
 * @desc Get voice command history
 */
router.get(
  '/history',
  historyValidation,
  handleValidationErrors,
  VoiceController.getHistory
);

module.exports = router;
