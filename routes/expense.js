const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const expenseController = require('../controllers/expenseController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const expenseReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many expense read requests.' }
});

const expenseWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many expense write requests.' }
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

// Validation chains
const createValidation = [
  body('amount')
    .isNumeric()
    .withMessage('Amount must be a numeric value'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required'),
  body('organizationId')
    .isMongoId()
    .withMessage('Valid organization ID is required')
];

const updateValidation = [
  param('expenseId')
    .isMongoId()
    .withMessage('Valid expense ID is required')
];

const approvalValidation = [
  param('expenseId')
    .isMongoId()
    .withMessage('Valid expense ID is required'),
  body('status')
    .isIn(['approved', 'rejected'])
    .withMessage('Status must be approved or rejected')
];

// Protected routes
router.use(authenticateUser);

// Routes with validation
router.post('/create', expenseWriteLimiter, createValidation, handleValidationErrors, expenseController.createExpense);
router.get('/categories', expenseReadLimiter, expenseController.getExpenseCategories);
router.get('/organization/:organizationId', expenseReadLimiter, param('organizationId').isMongoId(), handleValidationErrors, expenseController.getOrganizationExpenses);
router.get('/:expenseId', expenseReadLimiter, param('expenseId').isMongoId(), handleValidationErrors, expenseController.getExpenseById);
router.put('/:expenseId', expenseWriteLimiter, updateValidation, handleValidationErrors, expenseController.updateExpense);
router.delete('/:expenseId', expenseWriteLimiter, param('expenseId').isMongoId(), handleValidationErrors, expenseController.deleteExpense);
router.put('/:expenseId/approval', expenseWriteLimiter, approvalValidation, handleValidationErrors, expenseController.updateExpenseApproval);
router.post('/bulk-import', expenseWriteLimiter, body('expenses').isArray().withMessage('Expenses must be an array'), handleValidationErrors, expenseController.bulkImportExpenses);

module.exports = router;
