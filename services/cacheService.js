const redis = require('../config/redis');
const logger = require('../config/logger');
const { scopeKey } = require('../utils/envScope');

class CacheService {
  constructor() {
    this.defaultTTL = 3600; // 1 hour
  }

  /**
   * Get value from cache
   * @param {string} key 
   */
  async get(key) {
    try {
      const data = await redis.get(scopeKey(key));
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Cache Get Error [${key}]:`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttl Seconds
   */
  async set(key, value, ttl = this.defaultTTL) {
    try {
      await redis.set(scopeKey(key), JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      logger.error(`Cache Set Error [${key}]:`, error);
    }
  }

  /**
   * Delete from cache
   * @param {string} key 
   */
  async del(key) {
    try {
      await redis.del(scopeKey(key));
    } catch (error) {
      logger.error(`Cache Del Error [${key}]:`, error);
    }
  }

  /**
   * Clear cache by pattern using SCAN (safe for production)
   * @param {string} pattern 
   */
  async clearPattern(pattern) {
    // Scope the SCAN match as well: without it a dev pricing change would
    // delete prod's cached prices for the same organizationId (shared Valkey).
    const stream = redis.scanStream({
      match: scopeKey(pattern),
      count: 100
    });

    try {
      stream.on('data', async (keys) => {
        if (keys.length > 0) {
          await redis.del(keys);
        }
      });

      stream.on('end', () => {
        // logger.info(`Cache clear complete for pattern: ${pattern}`);
      });
    } catch (error) {
      logger.error(`Cache Clear Pattern Error [${pattern}]:`, error);
    }
  }
}

module.exports = new CacheService();
