const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const { authenticateUser } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

// Rate limiting
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes
  message: { success: false, message: 'Too many payment requests.' }
});

const refundLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 refunds per hour
  message: { success: false, message: 'Too many refund requests.' }
});

// Validation
const createIntentValidation = [
  body('invoiceId').notEmpty().withMessage('Invoice ID is required'),
  body('amount').notEmpty().isNumeric().withMessage('Amount must be a number'),
  body('organizationId').notEmpty().withMessage('Organization ID is required'),
  body('currency').optional().isIn(['AUD', 'USD', 'EUR', 'GBP']).withMessage('Invalid currency')
];

const recordPaymentValidation = [
  body('invoiceId').notEmpty().withMessage('Invoice ID is required'),
  body('paymentData').isObject().withMessage('Payment data must be an object'),
  body('paymentData.amount').optional().isNumeric().withMessage('Payment amount must be a number')
];

const creditNoteValidation = [
  body('invoiceId').notEmpty().withMessage('Invoice ID is required'),
  body('amount').optional().isNumeric().withMessage('Amount must be a number'),
  body('reason').optional().isString().trim()
];

const applyCreditValidation = [
  body('creditNoteId').notEmpty().withMessage('Credit note ID is required'),
  body('invoiceId').notEmpty().withMessage('Invoice ID is required'),
  body('amount').notEmpty().isNumeric().withMessage('Amount must be a number')
];

const refundValidation = [
  body('invoiceId').notEmpty().withMessage('Invoice ID is required'),
  body('amount').notEmpty().isNumeric().withMessage('Amount must be a number'),
  body('reason').optional().isString().trim()
];

// Payment Routes
router.post('/create-intent', 
  authenticateUser, 
  paymentLimiter, 
  createIntentValidation, 
  handleValidationErrors, 
  paymentController.createPaymentIntent
);

router.post('/onboarding-link', 
  authenticateUser, 
  paymentLimiter, 
  body('organizationId').notEmpty().withMessage('Organization ID is required'),
  handleValidationErrors, 
  paymentController.createOnboardingLink
);

router.post('/record', 
  authenticateUser, 
  paymentLimiter, 
  recordPaymentValidation, 
  handleValidationErrors, 
  paymentController.recordPayment
);

// Credit Note Routes
router.post('/credit-note', 
  authenticateUser, 
  paymentLimiter, 
  creditNoteValidation, 
  handleValidationErrors, 
  paymentController.createCreditNote
);

router.post('/credit-note/apply', 
  authenticateUser, 
  paymentLimiter, 
  applyCreditValidation, 
  handleValidationErrors, 
  paymentController.applyCreditNote
);

// Refund Route - stricter rate limiting
router.post('/refund', 
  authenticateUser, 
  refundLimiter, 
  refundValidation, 
  handleValidationErrors, 
  paymentController.refundPayment
);

module.exports = router;
