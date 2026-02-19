const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const workerController = require('../controllers/workerController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting for worker endpoints
// Workers check their dashboard frequently, so allow more requests than auth endpoints
const workerDashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes (reasonable for dashboard polling)
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many dashboard requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation chains
const getDashboardValidation = [
  query('organizationId')
    .optional()
    .isMongoId().withMessage('Invalid organization ID format')
    .trim(),
  query('date')
    .optional()
    .isISO8601().withMessage('Invalid date format')
];

/**
 * @route GET /api/worker/dashboard
 * @desc Get worker dashboard data (today's shifts, next shift, recent expenses, leave balances)
 * @access Private - Authenticated workers only
 * @rate-limit 100 requests per 15 minutes
 */
router.get(
  '/dashboard',
  workerDashboardLimiter,
  authenticateUser,
  getDashboardValidation,
  handleValidationErrors,
  workerController.getDashboard
);

module.exports = router;
