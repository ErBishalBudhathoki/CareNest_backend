/**
 * Express Application Configuration
 * Handles middleware setup, security, routes, and error handling.
 * 
 * @file backend/app.js
 */

const express = require("express");
const path = require('path');
const cors = require("cors");
const helmet = require("helmet");
const { environmentConfig } = require('./config/environment');

// Import Middleware
const { loggingMiddleware } = require('./middleware/logging');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { errorTrackingMiddleware } = require('./middleware/errorTracking');
const { systemHealthMiddleware } = require('./middleware/systemHealth');
const { requestLogger, securityLogger } = require('./middleware/requestLogger');
const { apiUsageMonitor } = require('./utils/apiUsageMonitor');

// Initialize express app
const app = express();

// Trust Proxy (Required for Cloud Run / Load Balancer)
app.set('trust proxy', 1);

// Security middleware - must be first
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = environmentConfig.getConfig().security.corsOrigins || [];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || environmentConfig.isDevelopmentEnvironment()) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
  credentials: true
};

app.use(cors(corsOptions));

// Webhook routes (Must be before express.json() to capture raw body)
app.use('/webhooks', require('./routes/webhookRoutes'));

// Body parsing
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    // Skip parsing for multipart/form-data - let Multer handle it
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      throw new Error('Multipart data should not be parsed by express.json()');
    }
  }
}));
app.use(express.urlencoded({
  extended: true,
  verify: (req, res, buf, encoding) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      throw new Error('Multipart data should not be parsed by express.urlencoded()');
    }
  }
}));

// Global Middleware
app.use(systemHealthMiddleware);
app.use(loggingMiddleware); // Legacy logger
app.use(requestLogger); // New structured request logger
app.use(securityLogger); // Security event logger
app.use(errorTrackingMiddleware);
app.use(apiUsageMonitor.middleware);

// API Documentation (Swagger)
app.use('/', require('./config/swagger'));

// DEV ONLY: Reset rate limits and IP blocks (no auth required)
// This endpoint is only available in development environment
// Placed BEFORE main routes to avoid auth middleware
app.post('/dev/reset-rate-limits', (req, res) => {
  // Only allow in development
  if (!environmentConfig.isDevelopmentEnvironment()) {
    return res.status(403).json({
      success: false,
      message: 'This endpoint is only available in development environment'
    });
  }

  try {
    const { AuthMiddleware } = require('./middleware/auth');

    // Clear blocked IPs
    if (AuthMiddleware.blockedIPs) {
      const blockedCount = AuthMiddleware.blockedIPs.size;
      AuthMiddleware.blockedIPs.clear();
      console.log(`[DEV] Cleared ${blockedCount} blocked IPs`);
    }

    // Clear failed attempts
    if (AuthMiddleware.failedAttempts) {
      const attemptsCount = AuthMiddleware.failedAttempts.size;
      AuthMiddleware.failedAttempts.clear();
      console.log(`[DEV] Cleared ${attemptsCount} failed attempt records`);
    }

    res.json({
      success: true,
      message: 'Rate limits and IP blocks cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[DEV] Error resetting rate limits:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting rate limits',
      error: error.message
    });
  }
});

// Health check endpoint (placed before main routes to ensure access)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: environmentConfig.getConfig().app.name,
    timestamp: new Date().toISOString(),
    environment: environmentConfig.getEnvironment()
  });
});

// Main API Routes
app.use('/', require('./routes'));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));





// Error handling middleware - must be added after all routes
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
