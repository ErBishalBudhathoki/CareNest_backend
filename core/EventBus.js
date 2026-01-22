const EventEmitter = require('events');
const redis = require('../config/redis');
const logger = require('../config/logger');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.pubClient = redis.duplicate();
    this.subClient = redis.duplicate();
    this.channel = 'app_events';
    
    // Subscribe to Redis channel for distributed events
    this.subClient.subscribe(this.channel, (err, count) => {
      if (err) {
        logger.error('Failed to subscribe to Redis channel', err);
      } else {
        logger.info(`Subscribed to ${count} Redis channel(s)`);
      }
    });

    this.subClient.on('message', (channel, message) => {
      if (channel === this.channel) {
        try {
          const { event, payload, source } = JSON.parse(message);
          // Emit locally, but mark as remote to avoid loops if needed
          // For now, we just emit to local listeners
          super.emit(event, payload, { source, remote: true });
        } catch (error) {
          logger.error('Error parsing distributed event', error);
        }
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
    logger.info(`Event Published: ${event}`, { payload });
    
    // 1. Emit locally immediately
    super.emit(event, payload, { source: 'local', remote: false });

    // 2. Publish to Redis for other services/instances
    if (!options.localOnly) {
      const message = JSON.stringify({
        event,
        payload,
        source: process.env.SERVICE_NAME || 'backend-core'
      });
      this.pubClient.publish(this.channel, message);
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
}

// Singleton instance
module.exports = new EventBus();
