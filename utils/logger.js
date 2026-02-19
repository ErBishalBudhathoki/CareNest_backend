const fs = require('fs');
const path = require('path');

/**
 * Simple logger utility for security events and errors
 * Provides structured logging with different levels
 */
class Logger {
  constructor(context = 'App') {
    this.context = context;
    this.logDir = path.join(process.cwd(), 'logs');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    // Skip directory creation in Cloud Run (K_SERVICE is set by Cloud Run)
    if (process.env.K_SERVICE) {
      return;
    }
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  formatMessage(level, message, data = {}) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      data,
      pid: process.pid
    });
  }

  writeToFile(level, formattedMessage) {
    // Skip file writing in Cloud Run - use stdout/stderr instead
    if (process.env.K_SERVICE) {
      return;
    }
    const filename = `${level}-${new Date().toISOString().split('T')[0]}.log`;
    const filepath = path.join(this.logDir, filename);
    
    try {
      fs.appendFileSync(filepath, formattedMessage + '\n', 'utf8');
    } catch (error) {
      // Fallback to console if file write fails
      console.error('Failed to write log to file:', error.message);
    }
  }

  log(level, message, data = {}) {
    const formattedMessage = this.formatMessage(level, message, data);
    
    // Console output for development or Cloud Run
    if (process.env.NODE_ENV === 'development' || process.env.K_SERVICE) {
      console.log(`[${level.toUpperCase()}] ${this.context}: ${message}`, data);
    }
    
    // File output only for non-Cloud Run environments
    if (!process.env.K_SERVICE) {
      this.writeToFile(level, formattedMessage);
    }
  }

  info(message, data = {}) {
    this.log('info', message, data);
  }

  warn(message, data = {}) {
    this.log('warn', message, data);
  }

  error(message, data = {}) {
    this.log('error', message, data);
  }

  debug(message, data = {}) {
    if (process.env.NODE_ENV === 'development') {
      this.log('debug', message, data);
    }
  }

  security(message, data = {}) {
    this.log('security', message, data);
    
    // Also write to dedicated security log
    const securityMessage = this.formatMessage('security', message, data);
    const securityFile = path.join(this.logDir, 'security.log');
    fs.appendFileSync(securityFile, securityMessage + '\n', 'utf8');
  }
}

/**
 * Factory function to create logger instances
 * @param {string} context - Context name for the logger
 * @returns {Logger} Logger instance
 */
function createLogger(context) {
  return new Logger(context);
}

module.exports = { Logger, createLogger };