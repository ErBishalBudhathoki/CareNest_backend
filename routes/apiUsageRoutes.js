const express = require('express');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { createLogger } = require('../utils/logger');
const {
  getApiUsageAnalytics,
  getRealTimeApiUsage,
  unblockIpAddress,
  getRateLimitConfig,
  streamApiUsageEvents
} = require('../endpoints/api_usage_endpoints');

const router = express.Router();
const logger = createLogger('ApiUsageRoutes');

// Rate limiting for API usage endpoints
const apiUsageRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests to API usage endpoints' },
  standardHeaders: true,
  legacyHeaders: false
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const unblockIpValidation = [
  body('ipAddress').isIP().withMessage('Valid IP address is required'),
  body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason too long')
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const dateRangeValidation = [
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

// Apply rate limiting to all API usage routes
router.use(apiUsageRateLimit);

// Require authentication and admin role for all API usage routes
router.use(authenticateUser);
router.use(requireRoles(['admin']));

/**
 * GET /api/analytics/api-usage/:organizationId
 * Get comprehensive API usage analytics
 */
router.get('/api-usage/:organizationId', strictLimiter, organizationIdValidation, dateRangeValidation, handleValidationErrors, async (req, res, next) => {
  try {
    const reserved = ['realtime', 'rate-limits', 'stream', 'unblock-ip'];
    if (reserved.includes(req.params.organizationId)) {
      return next();
    }
    await getApiUsageAnalytics(req, res);
  } catch (error) {
    logger.error('Error in API usage analytics route:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/api-usage/realtime/:organizationId
 * Get real-time API usage data
 */
router.get('/api-usage/realtime/:organizationId', strictLimiter, organizationIdValidation, handleValidationErrors, async (req, res) => {
  try {
    await getRealTimeApiUsage(req, res);
  } catch (error) {
    logger.error('Error in real-time API usage route:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/analytics/api-usage/unblock-ip
 * Unblock an IP address
 */
router.post('/api-usage/unblock-ip', strictLimiter, unblockIpValidation, handleValidationErrors, async (req, res) => {
  try {
    await unblockIpAddress(req, res);
  } catch (error) {
    logger.error('Error in unblock IP route:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/api-usage/rate-limits
 * Get rate limit configuration
 */
router.get('/api-usage/rate-limits', async (req, res) => {
  try {
    await getRateLimitConfig(req, res);
  } catch (error) {
    logger.error('Error in rate limit config route:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/api-usage/stream/:organizationId
 * Server-Sent Events stream for real-time API usage monitoring
 */
router.get('/api-usage/stream/:organizationId', strictLimiter, organizationIdValidation, handleValidationErrors, async (req, res) => {
  try {
    await streamApiUsageEvents(req, res);
  } catch (error) {
    logger.error('Error in API usage stream route:', { error: error.message });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

module.exports = router;
