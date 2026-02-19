const express = require('express');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const securityDashboardController = require('../controllers/securityDashboardController');

const router = express.Router();

// Rate limiting for security dashboard endpoints
const dashboardRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests to security dashboard' },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiting to all dashboard routes
router.use(dashboardRateLimit);

// Require authentication and admin role for all security dashboard routes
router.use(authenticateUser);
router.use(requireRoles(['admin']));

// Validation rules
const resetRateLimitValidation = [
  body('ip').optional().isIP().withMessage('Invalid IP address'),
  body('userId').optional().isMongoId().withMessage('Invalid user ID'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Invalid email'),
  body('resetAll').optional().isBoolean().withMessage('resetAll must be a boolean')
];

const testAlertValidation = [
  body('channel').optional().isIn(['email', 'webhook', 'sms']).withMessage('Channel must be email, webhook, or sms')
];

const unblockIpValidation = [
  body('ip').isIP().withMessage('Valid IP address is required')
];

const blockIpValidation = [
  body('ip').isIP().withMessage('Valid IP address is required'),
  body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason too long'),
  body('duration').optional().isInt({ min: 60000 }).withMessage('Duration must be at least 60 seconds (in ms)')
];

const eventsQueryValidation = [
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('type').optional().trim().isLength({ max: 100 }),
  query('severity').optional().isIn(['info', 'warning', 'error', 'critical']).withMessage('Invalid severity')
];

const historyLimitValidation = [
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000')
];

const topValidation = [
  query('top').optional().isInt({ min: 1, max: 500 }).withMessage('Top must be between 1 and 500')
];

const resetUserValidation = [
  body('userId').isMongoId().withMessage('Valid user ID is required')
];

/**
 * POST /api/security/dashboard/rate-limit/reset
 * Reset rate limiting for specific IP or user
 */
router.post(
  '/rate-limit/reset',
  resetRateLimitValidation,
  handleValidationErrors,
  securityDashboardController.resetRateLimit
);

/**
 * GET /api/security/dashboard/rate-limit/status
 * Get current rate limiting status
 */
router.get(
  '/rate-limit/status',
  securityDashboardController.getRateLimitStatus
);

/**
 * GET /api/security/dashboard/metrics
 * Get current security metrics
 */
router.get(
  '/dashboard/metrics',
  securityDashboardController.getMetrics
);

/**
 * GET /api/security/dashboard/report
 * Generate comprehensive security report
 */
router.get(
  '/dashboard/report',
  securityDashboardController.generateReport
);

/**
 * GET /api/security/dashboard/alerts/status
 * Get alerting system status
 */
router.get(
  '/dashboard/alerts/status',
  securityDashboardController.getAlertsStatus
);

/**
 * POST /api/security/dashboard/alerts/test
 * Test alert system
 */
router.post(
  '/dashboard/alerts/test',
  testAlertValidation,
  handleValidationErrors,
  securityDashboardController.testAlert
);

/**
 * GET /api/security/dashboard/blocked-ips
 * Get list of blocked IP addresses
 */
router.get(
  '/dashboard/blocked-ips',
  securityDashboardController.getBlockedIps
);

/**
 * POST /api/security/dashboard/unblock-ip
 * Manually unblock an IP address
 */
router.post(
  '/dashboard/unblock-ip',
  unblockIpValidation,
  handleValidationErrors,
  securityDashboardController.unblockIp
);

/**
 * POST /api/security/dashboard/block-ip
 * Manually block an IP address
 */
router.post(
  '/dashboard/block-ip',
  blockIpValidation,
  handleValidationErrors,
  securityDashboardController.blockIp
);

/**
 * GET /api/security/dashboard/events/recent
 * Get recent security events
 */
router.get(
  '/dashboard/events/recent',
  eventsQueryValidation,
  handleValidationErrors,
  securityDashboardController.getRecentEvents
);

/**
 * GET /api/security/dashboard/health
 * Get security system health status
 */
router.get(
  '/dashboard/health',
  securityDashboardController.getHealth
);

/**
 * GET /api/security/api-usage/summary
 * Get summarized API usage stats
 */
router.get(
  '/api-usage/summary',
  securityDashboardController.getApiUsageSummary
);

/**
 * GET /api/security/api-usage/history?limit=100
 * Get recent API request history
 */
router.get(
  '/api-usage/history',
  historyLimitValidation,
  handleValidationErrors,
  securityDashboardController.getApiUsageHistory
);

/**
 * GET /api/security/api-usage/endpoints
 * List endpoint stats (optionally top N)
 */
router.get(
  '/api-usage/endpoints',
  topValidation,
  handleValidationErrors,
  securityDashboardController.getApiEndpoints
);

/**
 * GET /api/security/api-usage/stream
 * Server-Sent Events (SSE) stream for real-time API usage updates
 */
router.get(
  '/api-usage/stream',
  securityDashboardController.streamApiUsage
);

/**
 * GET /api/security/api-usage/top-ips?top=50
 * List top IPs by request count (and error rate)
 */
router.get(
  '/api-usage/top-ips',
  topValidation,
  handleValidationErrors,
  securityDashboardController.getTopIps
);

/**
 * GET /api/security/api-usage/top-users?top=50
 * List top users by request count (and error rate)
 */
router.get(
  '/api-usage/top-users',
  topValidation,
  handleValidationErrors,
  securityDashboardController.getTopUsers
);

/**
 * POST /api/security/api-usage/reset
 * Reset all API usage stats (admin only)
 */
router.post(
  '/api-usage/reset',
  securityDashboardController.resetApiUsage
);

/**
 * Reset API usage stats for a specific user
 * POST /api/security/api-usage/reset-user
 */
router.post(
  '/api-usage/reset-user',
  resetUserValidation,
  handleValidationErrors,
  securityDashboardController.resetUserApiUsage
);

module.exports = router;
