const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const {
  processRecurringExpenses,
  createRecurringExpense,
  getRecurringExpenses,
  updateRecurringExpense,
  deactivateRecurringExpense,
  getRecurringExpenseStats
} = require('../services/recurringExpenseService');
const logger = require('../config/logger');

// Rate limiting configurations
const recurringExpenseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many recurring expense requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

const processLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many process requests.' }
});

// Validation rules
const processValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('processDate').optional().isISO8601().withMessage('Invalid process date')
];

const createTemplateValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('name').trim().notEmpty().withMessage('Template name is required'),
  body('name').isLength({ max: 200 }).withMessage('Name too long'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('frequency').isIn(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually']).withMessage('Invalid frequency'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').optional().isISO8601().withMessage('Invalid end date'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('paymentMethod').optional().trim().isLength({ max: 50 }),
  body('vendor').optional().trim().isLength({ max: 100 })
];

const updateTemplateValidation = [
  param('templateId').isMongoId().withMessage('Valid template ID is required'),
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be positive'),
  body('frequency').optional().isIn(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually']).withMessage('Invalid frequency'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
];

const getTemplatesValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('active').optional().isBoolean().withMessage('Active must be a boolean'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
];

const deactivateValidation = [
  param('templateId').isMongoId().withMessage('Valid template ID is required')
];

const statsValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

// Apply authentication to all routes
router.use(authenticateUser);

// Process due recurring expenses (admin only)
router.post('/recurring-expenses/process', requireRoles(['admin']), processLimiter, processValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId, processDate } = req.body;
    
    const result = await processRecurringExpenses({
      organizationId,
      processDate: processDate || new Date()
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Recurring expenses processing failed', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to process due recurring expenses' });
  }
});

// Create a new recurring expense template
router.post('/recurring-expenses/templates', strictLimiter, createTemplateValidation, handleValidationErrors, async (req, res) => {
  try {
    const templateData = req.body;
    const result = await createRecurringExpense(templateData);
    res.json(result);
  } catch (error) {
    logger.error('Recurring expense template creation failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.body.organizationId
    });
    res.status(500).json({ error: 'Failed to create recurring expense template' });
  }
});

// Get recurring expense templates for an organization
router.get('/recurring-expenses/templates/:organizationId', recurringExpenseLimiter, getTemplatesValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { active = true, page = 1, limit = 50 } = req.query;

    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    const result = await getRecurringExpenses(organizationId, {
      isActive: active === 'true',
      skip: (parsedPage - 1) * parsedLimit,
      limit: parsedLimit
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Recurring expense templates fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId
    });
    res.status(500).json({ error: 'Failed to fetch recurring expense templates' });
  }
});

// Update a recurring expense template
router.put('/recurring-expenses/templates/:templateId', strictLimiter, updateTemplateValidation, handleValidationErrors, async (req, res) => {
  try {
    const { templateId } = req.params;
    const updateData = req.body;
    
    const result = await updateRecurringExpense(templateId, updateData);
    res.json(result);
  } catch (error) {
    logger.error('Recurring expense template update failed', {
      error: error.message,
      stack: error.stack,
      templateId: req.params.templateId
    });
    res.status(500).json({ error: 'Failed to update recurring expense template' });
  }
});

// Deactivate a recurring expense template
router.delete('/recurring-expenses/templates/:templateId', strictLimiter, deactivateValidation, handleValidationErrors, async (req, res) => {
  try {
    const { templateId } = req.params;
    const deactivatedBy = req.body?.userEmail || req.user?.email;
    const result = await deactivateRecurringExpense(templateId, deactivatedBy);
    res.json(result);
  } catch (error) {
    logger.error('Recurring expense template deactivation failed', {
      error: error.message,
      stack: error.stack,
      templateId: req.params.templateId
    });
    res.status(500).json({ error: 'Failed to deactivate recurring expense template' });
  }
});

// Get recurring expense statistics
router.get('/recurring-expenses/stats/:organizationId', recurringExpenseLimiter, statsValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { startDate, endDate } = req.query;
    
    const stats = await getRecurringExpenseStats(organizationId, {
      startDate,
      endDate
    });
    
    res.json(stats);
  } catch (error) {
    logger.error('Recurring expense stats fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.params.organizationId
    });
    res.status(500).json({ error: 'Failed to fetch recurring expense stats' });
  }
});

module.exports = router;
