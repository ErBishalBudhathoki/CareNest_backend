const cors = require('cors');
const { createLogger } = require('../utils/logger');

const logger = createLogger('CORS');

/**
 * CORS middleware configuration
 * Uses environment-specific allowed origins
 */
const corsMiddleware = cors();

/**
 * Custom CORS headers middleware
 * SECURITY: Does NOT set wildcard Access-Control-Allow-Origin
 * Origin is controlled by main CORS configuration in app.js
 */
function customCorsHeaders(req, res, next) {
  res.header("Content-Type", "application/json");
  
  // DO NOT set Access-Control-Allow-Origin here
  // It is handled by the main CORS middleware in app.js
  // Setting wildcard (*) would bypass zero-trust security
  
  next();
}

/**
 * Validate CORS configuration on startup
 */
function validateCorsConfig() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  
  if (!allowedOrigins) {
    logger.warn('ALLOWED_ORIGINS not set. Only requests without origin (mobile apps) will be allowed.');
  } else {
    const origins = allowedOrigins.split(',');
    logger.info('CORS allowed origins configured', { 
      count: origins.length,
      origins: origins,
      environment: process.env.NODE_ENV 
    });
    
    // Warn if wildcard is configured
    if (origins.some(origin => origin === '*')) {
      logger.error('CRITICAL: Wildcard (*) origin detected in ALLOWED_ORIGINS. This is a security risk!');
    }
  }
}

// Validate on module load
validateCorsConfig();

module.exports = {
  corsMiddleware,
  customCorsHeaders
};
