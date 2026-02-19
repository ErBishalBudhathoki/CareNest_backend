const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const supportItemsController = require('../controllers/supportItemsController');
const router = express.Router();

// Rate limiting
const supportItemsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const searchValidation = [
  query('q').trim().notEmpty().withMessage('Search query is required'),
  query('q').isLength({ max: 100 }).withMessage('Search query too long'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
];

const allItemsValidation = [
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a positive integer')
];

// Protected routes
router.use(authenticateUser);

/**
 * Search support items
 * GET /api/support-items/search?q=...
 */
router.get('/api/support-items/search', supportItemsLimiter, searchValidation, handleValidationErrors, supportItemsController.searchSupportItems);

/**
 * Get all support items
 * GET /api/support-items/all
 */
router.get('/api/support-items/all', supportItemsLimiter, allItemsValidation, handleValidationErrors, supportItemsController.getAllSupportItems);

module.exports = router;
