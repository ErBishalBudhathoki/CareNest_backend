/**
 * Request/Response Logging Middleware
 * Comprehensive logging for all API requests with performance metrics
 * 
 * @file backend/middleware/requestLogger.js
 */

const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Generate correlation ID for request tracking
 */
const generateCorrelationId = () => {
  return uuidv4().split('-')[0]; // Shortened for readability
};

/**
 * Sanitize sensitive data from request/response bodies
 */
const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  
  const sanitized = { ...body };
  const sensitiveFields = [
    'password', 'token', 'authToken', 'refreshToken', 'creditCard', 
    'cvv', 'ssn', 'secret', 'apiKey', 'privateKey'
  ];
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '***REDACTED***';
    }
  });
  
  return sanitized;
};

/**
 * Request logging middleware
 * Logs incoming requests with timing
 */
const requestLogger = (req, res, next) => {
  // Generate correlation ID
  req.correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
  req.startTime = Date.now();
  
  // Add correlation ID to response headers
  res.setHeader('x-correlation-id', req.correlationId);
  
  // Log request
  logger.info('Incoming request', {
    correlationId: req.correlationId,
    method: req.method,
    url: req.originalUrl || req.url,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    body: req.body ? sanitizeBody(req.body) : undefined,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    userId: req.user?.userId || req.user?.id || 'anonymous',
    organizationId: req.user?.organizationId || req.body?.organizationId
  });
  
  // Override res.json to capture response
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const duration = Date.now() - req.startTime;
    
    // Log response
    logger.info('Request completed', {
      correlationId: req.correlationId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      durationMs: duration,
      responseSize: JSON.stringify(data).length,
      userId: req.user?.userId || req.user?.id || 'anonymous',
      success: data?.success || (res.statusCode >= 200 && res.statusCode < 300)
    });
    
    // Performance warning for slow requests
    if (duration > 5000) {
      logger.warn('Slow request detected', {
        correlationId: req.correlationId,
        method: req.method,
        url: req.originalUrl || req.url,
        duration: `${duration}ms`,
        threshold: '5000ms'
      });
    }
    
    return originalJson(data);
  };
  
  next();
};

/**
 * Error request logging middleware
 * Logs requests that result in errors
 */
const errorRequestLogger = (err, req, res, next) => {
  const duration = Date.now() - (req.startTime || Date.now());
  
  logger.error('Request failed', {
    correlationId: req.correlationId,
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode || 500,
    duration: `${duration}ms`,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    userId: req.user?.userId || req.user?.id || 'anonymous',
    body: req.body ? sanitizeBody(req.body) : undefined
  });
  
  next(err);
};

/**
 * Security event logging middleware
 * Logs potential security events
 */
const securityLogger = (req, res, next) => {
  const suspiciousPatterns = [
    { pattern: /[<>\"'`]/, type: 'XSS_ATTEMPT' },
    { pattern: /(union|select|insert|update|delete|drop|--|;)/i, type: 'SQL_INJECTION_ATTEMPT' },
    { pattern: /\.\./, type: 'PATH_TRAVERSAL_ATTEMPT' },
    { pattern: /<script/i, type: 'SCRIPT_INJECTION_ATTEMPT' }
  ];
  
  // Check query parameters
  const queryString = JSON.stringify(req.query);
  suspiciousPatterns.forEach(({ pattern, type }) => {
    if (pattern.test(queryString)) {
      logger.security('Suspicious request detected', {
        type,
        correlationId: req.correlationId,
        method: req.method,
        url: req.originalUrl || req.url,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }
  });
  
  next();
};

module.exports = {
  requestLogger,
  errorRequestLogger,
  securityLogger
};
