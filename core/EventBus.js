const EventEmitter = require('events');
const Redis = require('ioredis');
const redis = require('../config/redis');
const logger = require('../config/logger');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.channel = 'app_events';
    this.redisEnabled = false;
    this.pubClient = null;
    this.subClient = null;
    this.connectionErrors = 0;
    this.maxConnectionErrors = 5;

    // Check if Redis is available
    if (!redis.isConfigured || redis.status === 'circuit-open') {
      logger.warn('EventBus is running in local-only mode because Redis is unavailable');
      return;
    }

    this._initializeClients();
  }

  _buildConnectionOptions() {
    const redisUrl = redis.redisUrl;
    
    const baseOptions = {
      maxRetriesPerRequest: null,
      connectTimeout: 20000,
      commandTimeout: 15000,
      keepAlive: 10000,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('EventBus Redis retry limit exceeded');
          return null;
        }
        return Math.min(times * 2000, 10000);
      }
    };
    
    if (redisUrl) {
      try {
        // Parse URL to extract connection details
        let urlToParse = redisUrl;
        if (redisUrl.startsWith('redis://')) {
          urlToParse = redisUrl.replace('redis://', 'http://');
        } else if (redisUrl.startsWith('rediss://')) {
          urlToParse = redisUrl.replace('rediss://', 'https://');
        }
        
        const parsed = new URL(urlToParse);
        
        const options = {
          ...baseOptions,
          host: parsed.hostname,
          port: parseInt(parsed.port, 10) || 6379,
        };
        
        // Handle password (Redis Cloud: redis://default:PASSWORD@host:port)
        if (parsed.password) {
          options.password = decodeURIComponent(parsed.password);
        }
        
        // TLS for rediss://
        if (redisUrl.startsWith('rediss://')) {
          options.tls = { rejectUnauthorized: false };
        }
        
        return { url: redisUrl, options };
      } catch (err) {
        logger.error('Failed to parse Redis URL for EventBus', { error: err.message });
        return { url: redisUrl, options: baseOptions };
      }
    }
    
    return { options: { ...baseOptions, ...(redis.connectionOptions || {}) } };
  }

  _initializeClients() {
    const connectionConfig = this._buildConnectionOptions();
    
    try {
      const { url, options } = connectionConfig;
      
      if (url) {
        this.pubClient = new Redis(url, options);
        this.subClient = new Redis(url, options);
      } else {
        this.pubClient = redis.duplicate();
        this.subClient = redis.duplicate();
      }

      this._setupClientHandlers();
      this.redisEnabled = true;
      
    } catch (err) {
      logger.error('Failed to initialize EventBus Redis clients', { error: err.message });
      this.redisEnabled = false;
    }
  }

  _setupClientHandlers() {
    const handleError = (clientName) => (error) => {
      this.connectionErrors++;
      
      if (error.message.includes('ETIMEDOUT') || 
          error.message.includes('ECONNRESET') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('WRONGPASS') ||
          error.message.includes('Command timed out')) {
        logger.error(`EventBus ${clientName} connection error`, { 
          error: error.message,
          errors: this.connectionErrors 
        });
        
        if (this.connectionErrors >= this.maxConnectionErrors) {
          logger.error('EventBus disabling Redis due to repeated errors');
          this.redisEnabled = false;
        }
      }
    };

    this.pubClient?.on('error', handleError('publisher'));
    this.subClient?.on('error', handleError('subscriber'));

    this.subClient?.on('message', (channel, message) => {
      if (channel === this.channel) {
        try {
          const { event, payload, source } = JSON.parse(message);
          super.emit(event, payload, { source, remote: true });
        } catch (error) {
          logger.error('Error parsing distributed event', { error: error.message });
        }
      }
    });

    // Subscribe with error handling
    this.subClient?.subscribe(this.channel, (err, count) => {
      if (err) {
        logger.error('Failed to subscribe to Redis channel', { error: err.message });
        this.redisEnabled = false;
      } else {
        logger.info(`Subscribed to ${count} Redis channel(s)`);
      }
    });
  }

  /**
   * Publish an event to the system.
   * @param {string} event - The event name (e.g., 'shift.completed')
   * @param {Object} payload - Data associated with the event
   * @param {Object} options - Options (e.g., { localOnly: false })
   */
  publish(event, payload, options = { localOnly: false }) {
    // Always emit locally first
    super.emit(event, payload, { source: 'local', remote: false });

    // Log event
    logger.info(`Event Published: ${event}`, { payload });

    // Publish to Redis for distributed events
    if (!options.localOnly && this.redisEnabled && this.pubClient) {
      const message = JSON.stringify({
        event,
        payload,
        source: process.env.SERVICE_NAME || 'backend-core'
      });
      
      try {
        const publishResult = this.pubClient.publish(this.channel, message);
        Promise.resolve(publishResult).catch((error) => {
          logger.warn('Failed to publish distributed event', {
            event,
            error: error.message
          });
        });
      } catch (error) {
        logger.warn('Failed to publish distributed event', {
          event,
          error: error.message
        });
      }
    }
  }

  /**
   * Subscribe to an event.
   * @param {string} event - Event name
   * @param {Function} handler - Callback function
   */
  subscribe(event, handler) {
    logger.info(`Subscribed to event: ${event}`);
    this.on(event, handler);
  }

  /**
   * Close connections
   */
  async close() {
    try {
      await this.pubClient?.quit?.();
      await this.subClient?.quit?.();
    } catch {
      // Ignore errors on close
    }
  }
}

// Singleton instance
module.exports = new EventBus();
