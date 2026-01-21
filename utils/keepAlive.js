/**
 * Keep-Alive Service for Render Platform
 * Prevents server spin-down by periodically pinging the health endpoint
 */

const https = require('https');
const http = require('http');
const { environmentConfig } = require('../config/environment');
const { createLogger } = require('./logger');

const logger = createLogger('KeepAlive');

class KeepAliveService {
  constructor() {
    this.isEnabled = false;
    this.intervalId = null;
    this.pingInterval = 10 * 60 * 1000; // 10 minutes (less than 15-min timeout)
    this.serverUrl = null;
  }

  /**
   * Initialize keep-alive service
   * @param {string} serverUrl - The server URL to ping
   */
  initialize(serverUrl) {
    // Only enable in production (Render or Firebase/GCP)
    if (!environmentConfig.isProductionEnvironment()) {
      logger.info('Keep-alive service disabled in development mode');
      return;
    }

    // Check if running on Render or Firebase/GCP
    const isRender = process.env.RENDER || 
                     process.env.RENDER_SERVICE_ID || 
                     process.env.RENDER_EXTERNAL_URL ||
                     serverUrl?.includes('onrender.com');
                     
    const isGCP = process.env.K_SERVICE || 
                  process.env.FUNCTION_TARGET ||
                  process.env.GCLOUD_PROJECT ||
                  process.env.FIREBASE_CONFIG;

    if (!isRender && !isGCP) {
      logger.info('Keep-alive service disabled - not running on a supported platform (Render/GCP)');
      return;
    }

    // Use the provided URL or default to environment variable or fallback
    this.serverUrl = serverUrl || 
                     process.env.BACKEND_URL ||
                     process.env.PRODUCTION_URL ||
                     process.env.RENDER_EXTERNAL_URL || 
                     (isGCP ? `https://${process.env.GCLOUD_PROJECT}.web.app` : 'https://more-than-invoice.onrender.com');
    
    this.isEnabled = true;
    
    logger.info('Keep-alive service initialized', {
      serverUrl: this.serverUrl,
      interval: this.pingInterval / 1000 / 60 + ' minutes',
      platform: isRender ? 'Render' : 'GCP/Firebase'
    });

    this.start();
  }

  /**
   * Start the keep-alive pinging
   */
  start() {
    if (!this.isEnabled) return;

    // Initial delay of 3 minutes to let server fully start and be accessible
    setTimeout(() => {
      logger.info('Keep-alive service starting ping routine');
      this.ping();
      
      // Set up regular interval
      this.intervalId = setInterval(() => {
        this.ping();
      }, this.pingInterval);
      
      logger.info('Keep-alive service started successfully');
    }, 3 * 60 * 1000); // 3 minute initial delay
  }

  /**
   * Stop the keep-alive service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Keep-alive service stopped');
    }
  }

  /**
   * Ping the health endpoint
   */
  ping() {
    if (!this.isEnabled || !this.serverUrl) return;

    const url = `${this.serverUrl}/health`;
    const protocol = this.serverUrl.startsWith('https') ? https : http;

    const options = {
      method: 'GET',
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'KeepAlive-Service/1.0',
        'X-Keep-Alive': 'internal',
        'X-Service': 'more-than-invoice-backend'
      }
    };

    logger.info('Sending keep-alive ping', { 
      url: url,
      timestamp: new Date().toISOString() 
    });

    const req = protocol.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const healthData = JSON.parse(data);
            logger.info('Keep-alive ping successful', {
              statusCode: res.statusCode,
              serverStatus: healthData.status,
              uptime: Math.round(healthData.uptime / 60) + ' minutes',
              timestamp: new Date().toISOString()
            });
          } catch {
            logger.info('Keep-alive ping successful (non-JSON response)', {
              statusCode: res.statusCode,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          logger.warn('Keep-alive ping returned non-200 status', {
            statusCode: res.statusCode,
            response: data.substring(0, 200),
            timestamp: new Date().toISOString()
          });
        }
      });
    });

    req.on('error', (error) => {
      logger.error('Keep-alive ping failed', {
        error: error.message,
        url: url,
        timestamp: new Date().toISOString()
      });
    });

    req.on('timeout', () => {
      logger.warn('Keep-alive ping timeout', { 
        url: url,
        timestamp: new Date().toISOString() 
      });
      req.destroy();
    });

    req.end();
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      serverUrl: this.serverUrl,
      interval: this.pingInterval,
      running: !!this.intervalId
    };
  }
}

// Export singleton instance
const keepAliveService = new KeepAliveService();

module.exports = {
  KeepAliveService,
  keepAliveService
};