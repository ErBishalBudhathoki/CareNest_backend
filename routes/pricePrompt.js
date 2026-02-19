const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const { 
  organizationContextMiddleware, 
  requireOrganizationMatch,
  requireOrganizationOwnership
} = require('../middleware/organizationContext');
const logger = require('../config/logger');
const {
  createPricePrompt,
  resolvePricePrompt,
  getPendingPricePrompts,
  cancelPricePrompt,
  generateInvoiceWithPromptHandling,
  completeInvoiceGenerationAfterPrompts
} = require('../services/pricePromptService');

// Rate limiting configurations
const pricePromptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many price prompt requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const createPromptValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('supportItemNumber').trim().notEmpty().withMessage('Support item number is required'),
  body('supportItemNumber').isLength({ max: 50 }).withMessage('Support item number too long'),
  body('clientId').isMongoId().withMessage('Valid client ID is required'),
  body('serviceDate').isISO8601().withMessage('Valid service date is required'),
  body('requestedBy').isMongoId().withMessage('Valid requester ID is required'),
  body('context').optional().isObject().withMessage('Context must be an object'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Priority must be low, medium, high, or critical')
];

const resolvePromptValidation = [
  param('promptId').isMongoId().withMessage('Valid prompt ID is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('resolvedBy').isMongoId().withMessage('Valid resolver ID is required'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes too long'),
  body('createCustomPricing').optional().isBoolean().withMessage('createCustomPricing must be a boolean')
];

const getPendingValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('priority').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid priority filter'),
  query('supportItemNumber').optional().trim().isLength({ max: 50 }),
  query('clientId').optional().isMongoId().withMessage('Invalid client ID filter'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
];

const cancelPromptValidation = [
  param('promptId').isMongoId().withMessage('Valid prompt ID is required'),
  body('cancelledBy').isMongoId().withMessage('Valid canceller ID is required'),
  body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason too long')
];

const generateInvoiceValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('clientId').isMongoId().withMessage('Valid client ID is required'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required'),
  body('requestedBy').isMongoId().withMessage('Valid requester ID is required'),
  body('autoCreatePrompts').optional().isBoolean().withMessage('autoCreatePrompts must be a boolean')
];

const completeInvoiceValidation = [
  param('invoiceId').isMongoId().withMessage('Valid invoice ID is required'),
  body('completedBy').isMongoId().withMessage('Valid completer ID is required')
];

// Apply authentication to all routes
router.use(authenticateUser);
router.use(organizationContextMiddleware);

// Create a new price prompt for missing pricing
router.post('/api/price-prompts/create', pricePromptLimiter, requireOrganizationMatch('organizationId'), createPromptValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      organizationId,
      supportItemNumber,
      clientId,
      serviceDate,
      requestedBy,
      context,
      priority = 'medium'
    } = req.body;
    
    const result = await createPricePrompt({
      organizationId,
      supportItemNumber,
      clientId,
      serviceDate,
      requestedBy,
      context,
      priority
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price prompt creation failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.body.organizationId,
      supportItemNumber: req.body.supportItemNumber,
      clientId: req.body.clientId,
      serviceDate: req.body.serviceDate,
      requestedBy: req.body.requestedBy,
      priority: req.body.priority
    });
    res.status(500).json({ error: 'Failed to create price prompt' });
  }
});

// Resolve a price prompt with pricing information
router.post('/api/price-prompts/:promptId/resolve', strictLimiter, requireOrganizationOwnership('promptId', () => require('../models/PricePrompt')), resolvePromptValidation, handleValidationErrors, async (req, res) => {
  try {
    const { promptId } = req.params;
    const {
      price,
      resolvedBy,
      notes,
      createCustomPricing = false
    } = req.body;
    
    const result = await resolvePricePrompt(promptId, {
      price,
      resolvedBy,
      notes,
      createCustomPricing
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price prompt resolution failed', {
      error: error.message,
      stack: error.stack,
      promptId: req.params.promptId,
      price: req.body.price,
      resolvedBy: req.body.resolvedBy,
      createCustomPricing: req.body.createCustomPricing
    });
    res.status(500).json({ error: 'Failed to resolve price prompt' });
  }
});

// Get pending price prompts for an organization
router.get('/api/price-prompts/pending/:organizationId', pricePromptLimiter, getPendingValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const {
      priority,
      supportItemNumber,
      clientId,
      page = 1,
      limit = 50
    } = req.query;
    
    const result = await getPendingPricePrompts(organizationId, {
      priority,
      supportItemNumber,
      clientId,
      page: parseInt(page),
      limit: parseInt(limit)
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Pending price prompts fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId,
      priority: req.query.priority,
      supportItemNumber: req.query.supportItemNumber,
      clientId: req.query.clientId,
      page: req.query.page,
      limit: req.query.limit
    });
    res.status(500).json({ error: 'Failed to fetch pending price prompts' });
  }
});

// Cancel a price prompt
router.delete('/api/price-prompts/:promptId', strictLimiter, cancelPromptValidation, handleValidationErrors, async (req, res) => {
  try {
    const { promptId } = req.params;
    const { cancelledBy, reason } = req.body;
    
    const result = await cancelPricePrompt(promptId, {
      cancelledBy,
      reason
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Price prompt cancellation failed', {
      error: error.message,
      stack: error.stack,
      promptId: req.params.promptId,
      cancelledBy: req.body.cancelledBy,
      reason: req.body.reason
    });
    res.status(500).json({ error: 'Failed to cancel price prompt' });
  }
});

// Generate invoice with prompt handling for missing prices
router.post('/api/price-prompts/generate-invoice', strictLimiter, generateInvoiceValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      organizationId,
      clientId,
      startDate,
      endDate,
      requestedBy,
      autoCreatePrompts = true
    } = req.body;
    
    const result = await generateInvoiceWithPromptHandling({
      organizationId,
      clientId,
      startDate,
      endDate,
      requestedBy,
      autoCreatePrompts
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Invoice generation with prompt handling failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.body.organizationId,
      clientId: req.body.clientId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      requestedBy: req.body.requestedBy,
      autoCreatePrompts: req.body.autoCreatePrompts
    });
    res.status(500).json({ error: 'Failed to generate invoice with prompt handling' });
  }
});

// Complete invoice generation after all prompts are resolved
router.post('/api/price-prompts/complete-invoice/:invoiceId', strictLimiter, completeInvoiceValidation, handleValidationErrors, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { completedBy } = req.body;
    
    const result = await completeInvoiceGenerationAfterPrompts(invoiceId, {
      completedBy
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Invoice generation completion failed', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.invoiceId,
      completedBy: req.body.completedBy
    });
    res.status(500).json({ error: 'Failed to complete invoice generation' });
  }
});

module.exports = router;
