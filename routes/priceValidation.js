const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const logger = require('../config/logger');
const {
  validatePrice,
  validatePriceBatch,
  getPriceCaps,
  isQuoteRequired,
  validateInvoice,
  getPriceValidationStats
} = require('../services/priceValidationService');

// Rate limiting configurations
const priceValidationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many price validation requests.' }
});

const batchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many batch validation requests.' }
});

// Validation rules
const validatePriceValidation = [
  body('supportItemNumber').trim().notEmpty().withMessage('Support item number is required'),
  body('supportItemNumber').isLength({ max: 50 }).withMessage('Support item number too long'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('clientId').optional().isMongoId().withMessage('Invalid client ID'),
  body('serviceDate').optional().isISO8601().withMessage('Invalid service date'),
  body('location').optional().trim().isLength({ max: 100 }),
  body('duration').optional().isFloat({ min: 0 }).withMessage('Duration must be positive')
];

const validateBatchValidation = [
  body('items').isArray({ min: 1 }).withMessage('Items must be a non-empty array'),
  body('items.*.supportItemNumber').trim().notEmpty().withMessage('Each item must have a support item number'),
  body('items.*.price').isFloat({ min: 0 }).withMessage('Each item must have a valid price')
];

const getPriceCapsValidation = [
  param('supportItemNumber').trim().notEmpty().withMessage('Support item number is required'),
  query('location').optional().trim().isLength({ max: 100 }),
  query('serviceDate').optional().isISO8601().withMessage('Invalid service date')
];

const quoteRequiredValidation = [
  param('supportItemNumber').trim().notEmpty().withMessage('Support item number is required'),
  query('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  query('location').optional().trim().isLength({ max: 100 })
];

const validateInvoiceValidation = [
  body('invoiceData').isObject().withMessage('Invoice data is required'),
  body('invoiceData.organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('invoiceData.clientId').isMongoId().withMessage('Valid client ID is required'),
  body('invoiceData.lineItems').optional().isArray().withMessage('Line items must be an array')
];

const statsValidation = [
  query('organizationId').optional().isMongoId().withMessage('Invalid organization ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

// Apply authentication to all routes
router.use(authenticateUser);

// Validate a single price
router.post('/api/price-validation/validate', priceValidationLimiter, validatePriceValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      supportItemNumber,
      price,
      organizationId,
      clientId,
      serviceDate,
      location,
      duration
    } = req.body;
    
    const result = await validatePrice({
      supportItemNumber,
      price,
      organizationId,
      clientId,
      serviceDate,
      location,
      duration
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price validation failed', {
      error: error.message,
      stack: error.stack,
      supportItemNumber: req.body.supportItemNumber,
      price: req.body.price,
      organizationId: req.body.organizationId,
      clientId: req.body.clientId,
      serviceDate: req.body.serviceDate,
      location: req.body.location,
      duration: req.body.duration
    });
    res.status(500).json({ error: 'Failed to validate price' });
  }
});

// Validate multiple prices in batch
router.post('/api/price-validation/validate-batch', batchLimiter, validateBatchValidation, handleValidationErrors, async (req, res) => {
  try {
    const { items } = req.body;
    const result = await validatePriceBatch(items);
    res.json(result);
  } catch (error) {
    logger.error('Batch price validation failed', {
      error: error.message,
      stack: error.stack,
      itemCount: req.body.items?.length
    });
    res.status(500).json({ error: 'Failed to validate prices in batch' });
  }
});

// Get price caps for a support item
router.get('/api/price-validation/caps/:supportItemNumber', priceValidationLimiter, getPriceCapsValidation, handleValidationErrors, async (req, res) => {
  try {
    const { supportItemNumber } = req.params;
    const { location, serviceDate } = req.query;
    
    const caps = await getPriceCaps(supportItemNumber, {
      location,
      serviceDate
    });
    
    res.json(caps);
  } catch (error) {
    logger.error('Price caps fetch failed', {
      error: error.message,
      stack: error.stack,
      supportItemNumber: req.params.supportItemNumber,
      location: req.query.location,
      serviceDate: req.query.serviceDate
    });
    res.status(500).json({ error: 'Failed to fetch price caps' });
  }
});

// Check if quote is required for a support item
router.get('/api/price-validation/quote-required/:supportItemNumber', priceValidationLimiter, quoteRequiredValidation, handleValidationErrors, async (req, res) => {
  try {
    const { supportItemNumber } = req.params;
    const { price, location } = req.query;
    
    const quoteRequired = await isQuoteRequired(supportItemNumber, {
      price: parseFloat(price),
      location
    });
    
    res.json({ quoteRequired });
  } catch (error) {
    logger.error('Quote requirement check failed', {
      error: error.message,
      stack: error.stack,
      supportItemNumber: req.params.supportItemNumber,
      price: req.query.price,
      location: req.query.location
    });
    res.status(500).json({ error: 'Failed to check quote requirement' });
  }
});

// Validate an entire invoice
router.post('/api/price-validation/validate-invoice', priceValidationLimiter, validateInvoiceValidation, handleValidationErrors, async (req, res) => {
  try {
    const { invoiceData } = req.body;
    const result = await validateInvoice(invoiceData);
    res.json(result);
  } catch (error) {
    logger.error('Invoice validation failed', {
      error: error.message,
      stack: error.stack,
      invoiceData: req.body.invoiceData ? 'provided' : 'missing'
    });
    res.status(500).json({ error: 'Failed to validate invoice' });
  }
});

// Get price validation statistics
router.get('/api/price-validation/stats', priceValidationLimiter, statsValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId, startDate, endDate } = req.query;
    
    const stats = await getPriceValidationStats({
      organizationId,
      startDate,
      endDate
    });
    
    res.json(stats);
  } catch (error) {
    logger.error('Price validation stats fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
    res.status(500).json({ error: 'Failed to fetch price validation stats' });
  }
});

module.exports = router;
