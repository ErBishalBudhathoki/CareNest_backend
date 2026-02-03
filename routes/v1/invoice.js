const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');
const invoiceController = require('../../controllers/v1/invoiceController');
const { authenticateUser } = require('../../middleware/auth');

// Rate limiting
const invoiceReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many invoice read requests.' }
});

const invoiceWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window (lower for generation)
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many invoice write requests.' }
});

const bulkInvoiceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 bulk operations per hour
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many bulk invoice requests. Please try again later.' }
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

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validation chains
const generateLineItemsValidation = [
  body('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  body('clientEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid clientEmail is required'),
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  body('includeExpenses')
    .optional()
    .isBoolean()
    .withMessage('includeExpenses must be a boolean'),
  body('defaultState')
    .optional()
    .isLength({ min: 2, max: 3 })
    .withMessage('State must be 2-3 characters'),
  body('defaultProviderType')
    .optional()
    .isString()
    .withMessage('Provider type must be a string')
];

const getPreviewValidation = [
  param('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  param('clientEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid clientEmail is required'),
  query('startDate')
    .isISO8601()
    .withMessage('Start date query parameter is required and must be a valid ISO 8601 date'),
  query('endDate')
    .isISO8601()
    .withMessage('End date query parameter is required and must be a valid ISO 8601 date')
];

const getAssignmentsValidation = [
  param('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required')
];

const validateGenerationDataValidation = [
  body('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  body('clientEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid clientEmail is required'),
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  body('validatePricing')
    .optional()
    .isBoolean()
    .withMessage('validatePricing must be a boolean'),
  body('defaultState')
    .optional()
    .isLength({ min: 2, max: 3 })
    .withMessage('State must be 2-3 characters'),
  body('defaultProviderType')
    .optional()
    .isString()
    .withMessage('Provider type must be a string')
];

const bulkGenerateValidation = [
  body('organizationId')
    .trim()
    .notEmpty()
    .withMessage('Organization ID is required'),
  body('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  body('clients')
    .isArray({ min: 1 })
    .withMessage('At least one client is required for bulk generation'),
  body('usePreConfiguredPricing')
    .optional()
    .isBoolean()
    .withMessage('usePreConfiguredPricing must be a boolean'),
  body('skipPricePrompts')
    .optional()
    .isBoolean()
    .withMessage('skipPricePrompts must be a boolean'),
  body('includeExpenses')
    .optional()
    .isBoolean()
    .withMessage('includeExpenses must be a boolean'),
  body('batchSize')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Batch size must be between 1 and 50')
];

const validateLineItemsValidation = [
  body('lineItems')
    .isArray({ min: 1 })
    .withMessage('Line items array is required and must not be empty'),
  body('defaultState')
    .optional()
    .isLength({ min: 2, max: 3 })
    .withMessage('State must be 2-3 characters'),
  body('defaultProviderType')
    .optional()
    .isString()
    .withMessage('Provider type must be a string'),
  body('skipPriceValidation')
    .optional()
    .isBoolean()
    .withMessage('skipPriceValidation must be a boolean')
];

const validatePricingRealtimeValidation = [
  body('lineItems')
    .isArray({ min: 1 })
    .withMessage('Line items array is required and must not be empty'),
  body('state')
    .optional()
    .isLength({ min: 2, max: 3 })
    .withMessage('State must be 2-3 characters'),
  body('providerType')
    .optional()
    .isString()
    .withMessage('Provider type must be a string')
];

const validationReportValidation = [
  body('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  body('clientEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid clientEmail is required'),
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  body('defaultState')
    .optional()
    .isLength({ min: 2, max: 3 })
    .withMessage('State must be 2-3 characters'),
  body('defaultProviderType')
    .optional()
    .isString()
    .withMessage('Provider type must be a string')
];

// Apply authentication to all routes
router.use(authenticateUser);

// Invoice Generation Routes
router.post(
  '/generate-line-items',
  invoiceWriteLimiter,
  generateLineItemsValidation,
  handleValidationErrors,
  invoiceController.generateInvoiceLineItems
);

router.get(
  '/preview/:userEmail/:clientEmail',
  invoiceReadLimiter,
  getPreviewValidation,
  handleValidationErrors,
  invoiceController.getInvoicePreview
);

router.get(
  '/available-assignments/:userEmail',
  invoiceReadLimiter,
  getAssignmentsValidation,
  handleValidationErrors,
  invoiceController.getAvailableAssignments
);

router.post(
  '/validate-generation-data',
  invoiceReadLimiter,
  validateGenerationDataValidation,
  handleValidationErrors,
  invoiceController.validateInvoiceGenerationData
);

router.post(
  '/bulk-generate',
  bulkInvoiceLimiter,
  bulkGenerateValidation,
  handleValidationErrors,
  invoiceController.generateBulkInvoices
);

router.post(
  '/validate-line-items',
  invoiceReadLimiter,
  validateLineItemsValidation,
  handleValidationErrors,
  invoiceController.validateExistingInvoiceLineItems
);

router.post(
  '/validate-pricing-realtime',
  invoiceReadLimiter,
  validatePricingRealtimeValidation,
  handleValidationErrors,
  invoiceController.validatePricingRealtime
);

router.post(
  '/validation-report',
  invoiceReadLimiter,
  validationReportValidation,
  handleValidationErrors,
  invoiceController.getInvoiceValidationReport
);

module.exports = router;
