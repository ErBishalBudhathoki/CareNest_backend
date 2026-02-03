/**
 * Security Dashboard Controller
 * Handles security monitoring, alerting, and reporting
 * 
 * @file backend/controllers/securityDashboardController.js
 */

const { securityMonitor } = require('../utils/securityMonitor');
const { alertingSystem } = require('../utils/alertingSystem');
const { apiUsageMonitor } = require('../utils/apiUsageMonitor');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const { AuthMiddleware } = require('../middleware/auth');

class SecurityDashboardController {
  /**
   * Reset rate limiting for specific IP or user
   * POST /api/security/rate-limit/reset
   */
  resetRateLimit = catchAsync(async (req, res) => {
    const { ip, userId, email, resetAll } = req.body;
    
    logger.security('Rate limit reset attempt', {
      adminId: req.user.userId,
      adminEmail: req.user.email,
      targetIp: ip,
      targetUserId: userId,
      targetEmail: email,
      resetAll: resetAll,
      ip: req.ip
    });
    
    let resetCount = 0;
    
    if (resetAll) {
      AuthMiddleware.failedAttempts.clear();
      AuthMiddleware.blockedIPs.clear();
      resetCount = 'all';
      
      logger.security('All rate limits reset', {
        adminId: req.user.userId,
        adminEmail: req.user.email,
        ip: req.ip
      });
    } else if (ip) {
      AuthMiddleware.resetFailedAttempts(ip);
      resetCount = 1;
      
      logger.security('IP rate limit reset', {
        adminId: req.user.userId,
        adminEmail: req.user.email,
        targetIp: ip,
        ip: req.ip
      });
    } else {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PARAMETERS',
        message: 'Missing required parameters. Please provide ip, userId, email, or resetAll.'
      });
    }
    
    res.json({
      success: true,
      code: 'RATE_LIMIT_RESET',
      message: `Rate limits reset successfully for ${resetCount} entries`,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get current rate limiting status
   * GET /api/security/rate-limit/status
   */
  getRateLimitStatus = catchAsync(async (req, res) => {
    const blockedIPs = AuthMiddleware.getBlockedIPsAdmin();
    const failedAttempts = AuthMiddleware.getFailedAttemptsSnapshot();
    
    res.json({
      success: true,
      code: 'RATE_LIMIT_STATUS_RETRIEVED',
      data: {
        blockedIPs,
        failedAttempts,
        totalBlocked: blockedIPs.length,
        totalWithFailedAttempts: failedAttempts.length
      },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get current security metrics
   * GET /api/security/dashboard/metrics
   */
  getMetrics = catchAsync(async (req, res) => {
    const metrics = securityMonitor.getMetrics();
    
    logger.security('Security dashboard metrics accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.json({
      success: true,
      code: 'METRICS_RETRIEVED',
      data: metrics,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Generate comprehensive security report
   * GET /api/security/dashboard/report
   */
  generateReport = catchAsync(async (req, res) => {
    const report = securityMonitor.generateSecurityReport();
    
    logger.security('Security report generated', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      reportPeriod: report.period
    });
    
    res.json({
      success: true,
      code: 'REPORT_GENERATED',
      data: report,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get alerting system status
   * GET /api/security/dashboard/alerts/status
   */
  getAlertsStatus = catchAsync(async (req, res) => {
    const status = alertingSystem.getStatus();
    
    logger.security('Alert system status checked', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip
    });
    
    res.json({
      success: true,
      code: 'ALERT_STATUS_RETRIEVED',
      data: status,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Test alert system
   * POST /api/security/dashboard/alerts/test
   */
  testAlert = catchAsync(async (req, res) => {
    const { channel } = req.body;
    
    await alertingSystem.testAlert(channel);
    
    logger.security('Alert system test triggered', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      channel: channel || 'all'
    });
    
    res.json({
      success: true,
      code: 'TEST_ALERT_SENT',
      message: `Test alert sent via ${channel || 'all channels'}`,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get list of blocked IP addresses
   * GET /api/security/dashboard/blocked-ips
   */
  getBlockedIps = catchAsync(async (req, res) => {
    const metrics = securityMonitor.getMetrics();
    const blockedIPs = metrics.blockedIPs;
    
    logger.security('Blocked IPs list accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      blockedCount: blockedIPs.length
    });
    
    res.json({
      success: true,
      code: 'BLOCKED_IPS_RETRIEVED',
      data: {
        blockedIPs,
        count: blockedIPs.length,
        lastUpdated: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Manually unblock an IP address
   * POST /api/security/dashboard/unblock-ip
   */
  unblockIp = catchAsync(async (req, res) => {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'IP address is required'
      });
    }
    
    if (!securityMonitor.isIPBlocked(ip)) {
      return res.status(404).json({
        success: false,
        code: 'IP_NOT_BLOCKED',
        message: 'IP address is not currently blocked'
      });
    }
    
    securityMonitor.unblockIP(ip);
    
    logger.security('IP manually unblocked', {
      userId: req.user.id,
      userEmail: req.user.email,
      adminIP: req.ip,
      unblockedIP: ip,
      reason: 'Manual admin action'
    });
    
    res.json({
      success: true,
      code: 'IP_UNBLOCKED',
      message: `IP address ${ip} has been unblocked`,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Manually block an IP address
   * POST /api/security/dashboard/block-ip
   */
  blockIp = catchAsync(async (req, res) => {
    const { ip, reason, duration } = req.body;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'IP address is required'
      });
    }
    
    if (ip === req.ip) {
      return res.status(400).json({
        success: false,
        code: 'SELF_BLOCK_PREVENTED',
        message: 'Cannot block your own IP address'
      });
    }
    
    if (securityMonitor.isIPBlocked(ip)) {
      return res.status(409).json({
        success: false,
        code: 'IP_ALREADY_BLOCKED',
        message: 'IP address is already blocked'
      });
    }
    
    const blockDuration = duration || 60 * 60 * 1000;
    const blockReason = reason || 'Manual admin block';
    
    securityMonitor.blockIP(ip, blockReason, blockDuration);
    
    logger.security('IP manually blocked', {
      userId: req.user.id,
      userEmail: req.user.email,
      adminIP: req.ip,
      blockedIP: ip,
      reason: blockReason,
      duration: blockDuration
    });
    
    res.json({
      success: true,
      code: 'IP_BLOCKED',
      message: `IP address ${ip} has been blocked`,
      details: {
        ip,
        reason: blockReason,
        duration: blockDuration,
        expiresAt: new Date(Date.now() + blockDuration).toISOString()
      },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get recent security events
   * GET /api/security/dashboard/events/recent
   */
  getRecentEvents = catchAsync(async (req, res) => {
    const { limit = 50, type, severity } = req.query;
    const metrics = securityMonitor.getMetrics();
    
    let events = [];
    
    if (metrics.recentEvents) {
      Object.entries(metrics.recentEvents).forEach(([eventType, eventList]) => {
        eventList.forEach(event => {
          events.push({
            ...event,
            eventType
          });
        });
      });
    }
    
    if (type) {
      events = events.filter(event => event.eventType === type);
    }
    
    if (severity) {
      events = events.filter(event => event.severity === severity);
    }
    
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    events = events.slice(0, parseInt(limit));
    
    logger.security('Recent security events accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      eventCount: events.length,
      filters: { type, severity, limit }
    });
    
    res.json({
      success: true,
      code: 'EVENTS_RETRIEVED',
      data: {
        events,
        count: events.length,
        filters: { type, severity, limit: parseInt(limit) }
      },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get security system health status
   * GET /api/security/dashboard/health
   */
  getHealth = catchAsync(async (req, res) => {
    const metrics = securityMonitor.getMetrics();
    const alertStatus = alertingSystem.getStatus();
    
    const health = {
      overall: 'healthy',
      components: {
        securityMonitor: {
          status: 'healthy',
          totalEvents: metrics.totalEvents,
          lastActivity: new Date().toISOString()
        },
        alertingSystem: {
          status: alertStatus.channels.email.configured || alertStatus.channels.webhook.configured ? 'healthy' : 'degraded',
          emailChannel: alertStatus.channels.email.configured ? 'configured' : 'not configured',
          webhookChannel: alertStatus.channels.webhook.configured ? 'configured' : 'not configured',
          queueSize: alertStatus.queue.pending
        },
        rateLimiting: {
          status: 'healthy',
          blockedIPs: metrics.blockedIPs.length
        }
      },
      metrics: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    };
    
    const componentStatuses = Object.values(health.components).map(c => c.status);
    if (componentStatuses.includes('critical')) {
      health.overall = 'critical';
    } else if (componentStatuses.includes('degraded')) {
      health.overall = 'degraded';
    }
    
    logger.security('Security system health checked', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      overallHealth: health.overall
    });
    
    res.json({
      success: true,
      code: 'HEALTH_RETRIEVED',
      data: health,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get summarized API usage stats
   * GET /api/security/api-usage/summary
   */
  getApiUsageSummary = catchAsync(async (req, res) => {
    const summary = apiUsageMonitor.getSummary();

    logger.security('API usage summary accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip
    });

    res.json({
      success: true,
      code: 'API_USAGE_SUMMARY_RETRIEVED',
      data: summary,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Get recent API request history
   * GET /api/security/api-usage/history
   */
  getApiUsageHistory = catchAsync(async (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10), 1000));
    const history = apiUsageMonitor.getHistory(limit);

    logger.security('API usage history accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      limit
    });

    res.json({
      success: true,
      code: 'API_USAGE_HISTORY_RETRIEVED',
      data: { history, count: history.length },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * List endpoint stats
   * GET /api/security/api-usage/endpoints
   */
  getApiEndpoints = catchAsync(async (req, res) => {
    const top = Math.max(1, Math.min(parseInt(req.query.top || '50', 10), 500));
    const endpoints = apiUsageMonitor.getEndpoints();
    const sorted = endpoints.sort((a, b) => b.count - a.count).slice(0, top);

    logger.security('API usage endpoints accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      top
    });

    res.json({
      success: true,
      code: 'API_ENDPOINTS_RETRIEVED',
      data: { endpoints: sorted, total: endpoints.length },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * List top IPs
   * GET /api/security/api-usage/top-ips
   */
  getTopIps = catchAsync(async (req, res) => {
    const top = Math.max(1, Math.min(parseInt(req.query.top || '50', 10), 500));
    const ips = apiUsageMonitor.getTopIPs(top);

    logger.security('API usage top IPs accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      top
    });

    res.json({ 
      success: true, 
      code: 'TOP_IPS_RETRIEVED',
      data: { ips, count: ips.length }, 
      timestamp: new Date().toISOString() 
    });
  });

  /**
   * List top users
   * GET /api/security/api-usage/top-users
   */
  getTopUsers = catchAsync(async (req, res) => {
    const top = Math.max(1, Math.min(parseInt(req.query.top || '50', 10), 500));
    const users = apiUsageMonitor.getTopUsers(top);

    logger.security('API usage top users accessed', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip,
      top
    });

    res.json({ 
      success: true, 
      code: 'TOP_USERS_RETRIEVED',
      data: { users, count: users.length }, 
      timestamp: new Date().toISOString() 
    });
  });

  /**
   * Reset all API usage stats
   * POST /api/security/api-usage/reset
   */
  resetApiUsage = catchAsync(async (req, res) => {
    apiUsageMonitor.reset();

    logger.security('API usage stats reset', {
      userId: req.user.id,
      userEmail: req.user.email,
      ip: req.ip
    });

    res.json({ 
      success: true, 
      code: 'API_USAGE_RESET',
      message: 'API usage stats reset', 
      timestamp: new Date().toISOString() 
    });
  });

  /**
   * Reset API usage stats for a specific user
   * POST /api/security/api-usage/reset-user
   */
  resetUserApiUsage = catchAsync(async (req, res) => {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        code: 'VALIDATION_ERROR',
        message: 'User ID is required' 
      });
    }
    
    const result = apiUsageMonitor.reset(userId);
    
    if (result) {
      logger.security('API usage stats reset for specific user', {
        targetUserId: userId,
        requestedByUserId: req.user.id,
        requestedByEmail: req.user.email,
        ip: req.ip
      });
      
      res.json({ 
        success: true, 
        code: 'USER_USAGE_RESET',
        message: `API usage stats reset for user ${userId}`, 
        timestamp: new Date().toISOString() 
      });
    } else {
      res.status(404).json({ 
        success: false, 
        code: 'USER_NOT_FOUND',
        message: `User ${userId} not found in API usage stats` 
      });
    }
  });

  /**
   * Stream API usage updates (SSE)
   * GET /api/security/api-usage/stream
   * Note: SSE doesn't work well with catchAsync due to persistent connection
   */
  streamApiUsage = async (req, res) => {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const initial = apiUsageMonitor.getSummary();
      res.write(`event: ready\n`);
      res.write(`data: ${JSON.stringify({ message: 'SSE connected', initial })}\n\n`);

      const cleanup = apiUsageMonitor.addSSEClient(res, { ip: req.ip, userId: req.user?.id || req.user?.userId || null });

      logger.security('API usage SSE stream started', {
        userId: req.user.id,
        userEmail: req.user.email,
        ip: req.ip
      });

      req.on('close', () => {
        cleanup();
        logger.security('API usage SSE stream closed', {
          userId: req.user.id,
          userEmail: req.user.email,
          ip: req.ip
        });
      });
    } catch (error) {
      logger.error('Failed to start SSE stream', {
        error: error.message,
        userId: req.user.id,
        ip: req.ip
      });
      res.status(500).json({ success: false, message: 'Failed to start SSE stream' });
    }
  };
}

module.exports = new SecurityDashboardController();
