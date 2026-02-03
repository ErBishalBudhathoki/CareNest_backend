const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const multiOrgController = require('../controllers/multiOrgController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const multiOrgReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many multi-org requests.' }
});

// Validation
const rollupValidation = [
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('includeInactive').optional().isBoolean().withMessage('includeInactive must be boolean')
];

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * @route GET /api/multiorg/rollup
 * @desc Get multi-organization rollup statistics
 * @access Private
 */
router.get('/rollup', multiOrgReadLimiter, rollupValidation, handleValidationErrors, multiOrgController.getRollup);

module.exports = router;
