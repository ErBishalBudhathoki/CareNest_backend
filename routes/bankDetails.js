const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const bankDetailsController = require('../controllers/bankDetailsController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const bankLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many bank details requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const saveBankDetailsValidation = [
  body('accountName').trim().notEmpty().withMessage('Account name is required'),
  body('bsb').trim().matches(/^[0-9]{6}$/).withMessage('BSB must be 6 digits'),
  body('accountNumber').trim().matches(/^[0-9]{4,9}$/).withMessage('Account number must be 4-9 digits'),
  body('bankName').optional().trim().isLength({ max: 100 }),
  body('userEmail').optional().isEmail().normalizeEmail().withMessage('Invalid email format')
];

const getBankDetailsValidation = [
  query('userEmail').isEmail().normalizeEmail().withMessage('Valid email is required')
];

// Protected routes
router.use(authenticateUser);

/**
 * Bank details routes
 * Maintains existing paths for compatibility but secured
 */
router.post('/saveBankDetails', strictLimiter, saveBankDetailsValidation, handleValidationErrors, bankDetailsController.saveBankDetails);
router.get('/getBankDetails', bankLimiter, getBankDetailsValidation, handleValidationErrors, bankDetailsController.getBankDetails);

module.exports = router;
