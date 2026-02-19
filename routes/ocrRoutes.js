const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const ocrController = require('../controllers/ocrController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const ocrLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many OCR requests.' }
});

// Validation
const parseValidation = [
  body('rawText').trim().notEmpty().withMessage('rawText is required'),
  body('rawText').isLength({ max: 10000 }).withMessage('Text too long (max 10000 characters)'),
  body('merchantName').optional().trim().isLength({ max: 200 }),
  body('date').optional().isISO8601().withMessage('Invalid date'),
  body('total').optional().isFloat({ min: 0 }).withMessage('Total must be a positive number'),
  body('currency').optional().isIn(['AUD', 'USD', 'EUR', 'GBP', 'NZD']).withMessage('Invalid currency')
];

// Protected routes
router.use(authenticateUser);

/**
 * @route POST /api/ocr/parse
 * @desc Parse raw text from receipt OCR
 * @access Private
 */
router.post('/parse', ocrLimiter, parseValidation, handleValidationErrors, ocrController.parseReceipt);

module.exports = router;
