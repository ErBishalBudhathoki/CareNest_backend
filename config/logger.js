const winston = require('winston');
const path = require('path');

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define log colors for console output
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(logColors);

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const logEntry = {
      timestamp: info.timestamp,
      level: info.level,
      message: info.message,
      service: 'invoice-backend',
      environment: process.env.NODE_ENV || 'development',
      ...info.metadata
    };

    // Add stack trace for errors
    if (info.stack) {
      logEntry.stack = info.stack;
    }

    return JSON.stringify(logEntry);
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    return `${info.timestamp} [${info.level}]: ${info.message}`;
  })
);

// Create logs directory if it doesn't exist (skip in Cloud Run)
const logsDir = '/var/log/backend';
const fs = require('fs');
const isCloudRun = !!process.env.K_SERVICE;

if (!isCloudRun && !fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // Fallback to local logs directory if /var/log/backend is not writable
    const localLogsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(localLogsDir)) {
      fs.mkdirSync(localLogsDir, { recursive: true });
    }
  }
}

// Determine log directory (prefer /var/log/backend for Docker, fallback to local)
// Skip entirely in Cloud Run
const getLogDir = () =\u003e {
  if (isCloudRun) {
    return null; // No file logging in Cloud Run
  }
  try {
    fs.accessSync('/var/log/backend', fs.constants.W_OK);
    return '/var/log/backend';
  } catch {
    return path.join(__dirname, '../logs');
  }
};

const logDir = getLogDir();

// Build transports array - console only in Cloud Run, files + console elsewhere
const transports = [];

// Add file transports only if not in Cloud Run
if (!isCloudRun && logDir) {
  transports.push(
    // Error logs
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    // Application logs
    new winston.transports.File({
      filename: path.join(logDir, 'application.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    // Access logs (for HTTP requests)
    new winston.transports.File({
      filename: path.join(logDir, 'access.log'),
      level: 'http',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );
}

// Always add console transport in Cloud Run or development
if (isCloudRun || process.env.NODE_ENV !== 'production') {
  transports.push(new winston.transports.Console({
    format: isCloudRun ? structuredFormat : consoleFormat,
    level: 'debug'
  }));
}

// Build exception handlers - console only in Cloud Run
const exceptionHandlers = [];
if (!isCloudRun && logDir) {
  exceptionHandlers.push(new winston.transports.File({
    filename: path.join(logDir, 'exceptions.log'),
    maxsize: 10485760, // 10MB
    maxFiles: 3
  }));
}
if (isCloudRun) {
  exceptionHandlers.push(new winston.transports.Console({
    format: structuredFormat
  }));
}

// Build rejection handlers - console only in Cloud Run
const rejectionHandlers = [];
if (!isCloudRun && logDir) {
  rejectionHandlers.push(new winston.transports.File({
    filename: path.join(logDir, 'rejections.log'),
    maxsize: 10485760, // 10MB
    maxFiles: 3
  }));
}
if (isCloudRun) {
  rejectionHandlers.push(new winston.transports.Console({
    format: structuredFormat
  }));
}

// Create winston logger
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: structuredFormat,
  defaultMeta: { service: 'invoice-backend' },
  transports,
  exceptionHandlers,
  rejectionHandlers
});

// Note: Console transport is already added in transports array above
// No need to add it again here

// Helper functions for structured logging
const createLogMethods = (logger) => {
  return {
    error: (message, metadata = {}) => logger.error(message, { metadata }),
    warn: (message, metadata = {}) => logger.warn(message, { metadata }),
    info: (message, metadata = {}) => logger.info(message, { metadata }),
    http: (message, metadata = {}) => logger.http(message, { metadata }),
    debug: (message, metadata = {}) => logger.debug(message, { metadata }),

    // Specialized logging methods
    request: (req, metadata = {}) => {
      logger.http('HTTP Request', {
        metadata: {
          method: req.method,
          url: req.url,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          ...metadata
        }
      });
    },

    response: (req, res, responseTime, metadata = {}) => {
      logger.http('HTTP Response', {
        metadata: {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          responseTime: `${responseTime}ms`,
          ip: req.ip,
          ...metadata
        }
      });
    },

    database: (operation, collection, metadata = {}) => {
      logger.info('Database Operation', {
        metadata: {
          operation,
          collection,
          ...metadata
        }
      });
    },

    auth: (action, userEmail, metadata = {}) => {
      logger.info('Authentication Event', {
        metadata: {
          action,
          userEmail,
          ...metadata
        }
      });
    },

    business: (event, metadata = {}) => {
      logger.info('Business Event', {
        metadata: {
          event,
          ...metadata
        }
      });
    }
  };
};

// Create logger with helper methods
const loggerWithHelpers = {
  ...createLogMethods(logger),
  winston: logger,
  logDir,
  // Add createLogger compatibility method
  createLogger: (serviceName) => {
    // Return a child logger or wrapper that includes the service name in metadata
    // For simplicity, we'll just return the main logger but with a bound method to add serviceName
    const childLogger = logger.child({ service: serviceName });
    return {
      ...createLogMethods(childLogger),
      winston: childLogger,
      // Security logger method
      security: (message, metadata = {}) => childLogger.warn(message, { metadata: { ...metadata, type: 'SECURITY' } })
    };
  },
  // Add security logger to main export
  security: (message, metadata = {}) => logger.warn(message, { metadata: { ...metadata, type: 'SECURITY' } })
};

// Export logger with helper methods
module.exports = loggerWithHelpers;