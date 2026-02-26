const EventEmitter = require('events');
const redis = require('../config/redis');
const logger = require('../config/logger');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.channel = 'app_events';
    this.redisEnabled = false;
    this.subscribed = false;
    this.connectionErrors = 0;
    this.maxConnectionErrors = 5;

    // Check if Redis is available
    if (!redis.isConfigured || redis.status === 'disabled') {
      logger.warn('EventBus is running in local-only mode because Redis is unavailable');
      return;
    }

    // Use the shared redis connection instead of creating duplicates
    // This saves Redis connections in CloudRun
    this._initializeWithSharedConnection();
  }

  _initializeWithSharedConnection() {
    try {
      // For pub/sub, we need a dedicated connection for subscribe
      // But we can use the shared connection for publish
      // In CloudRun, we'll use local-only mode to save connections
      
      const isCloudRun = Boolean(process.env.K_SERVICE);
      
      if (isCloudRun) {
        // In CloudRun, run in local-only mode to conserve Redis connections
        // EventBus pub/sub across instances would need a dedicated connection per instance
        logger.info('EventBus running in local-only mode (CloudRun - conserving connections)');
        return;
      }

      // In non-CloudRun environments, set up full pub/sub
      this._setupPubSub();
    } catch (err) {
      logger.error('Failed to initialize EventBus', { error: err.message });
    }
  }

  _setupPubSub() {
    // Subscribe using the shared connection
    redis.subscribe(this.channel, (err, count) => {
      if (err) {
        logger.error('Failed to subscribe to Redis channel', { error: err.message });
        return;
      }
      this.subscribed = true;
      this.redisEnabled = true;
      logger.info(`Subscribed to ${count} Redis channel(s)`);
    });

    // Handle incoming messages
    redis.on('message', (channel, message) => {
      if (channel === this.channel) {
        try {
          const { event, payload, source } = JSON.parse(message);
          super.emit(event, payload, { source, remote: true });
        } catch (error) {
          logger.error('Error parsing distributed event', { error: error.message });
        }
      }
    });

    redis.on('error', (error) => {
      this.connectionErrors++;
      if (this.connectionErrors >= this.maxConnectionErrors) {
        logger.error('EventBus disabling due to Redis errors');
        this.redisEnabled = false;
      }
    });

    this.redisEnabled = true;
  }

  /**
   * Publish an event to the system.
   * Always emits locally, publishes to Redis if available.
   */
  publish(event, payload, options = { localOnly: false }) {
    // Always emit locally first
    super.emit(event, payload, { source: 'local', remote: false });

    // Log event
    logger.info(`Event Published: ${event}`, { payload });

    // Publish to Redis for distributed events
    if (!options.localOnly && this.redisEnabled && redis.isConfigured) {
      const message = JSON.stringify({
        event,
        payload,
        source: process.env.SERVICE_NAME || 'backend-core'
      });
      
      try {
        redis.publish(this.channel, message).catch((error) => {
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
   */
  subscribe(event, handler) {
    logger.info(`Subscribed to event: ${event}`);
    this.on(event, handler);
  }

  /**
   * Close connections
   */
  async close() {
    if (this.subscribed) {
      try {
        await redis.unsubscribe(this.channel);
      } catch {
        // Ignore errors on close
      }
    }
  }
}

// Singleton instance
module.exports = new EventBus();
