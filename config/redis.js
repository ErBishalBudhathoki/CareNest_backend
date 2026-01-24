const Redis = require('ioredis');
const logger = require('./logger');

const redisConfig = process.env.REDIS_URL || {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// If using a URL string, ioredis handles parsing automatically
// If REDIS_URL starts with rediss://, it implies TLS
let redis;
if (typeof redisConfig === 'string') {
  redis = new Redis(redisConfig);
} else {
  redis = new Redis(redisConfig);
}

redis.on('connect', () => {
  // Mask password in connection details log
  const maskedConfig = typeof redisConfig === 'string'
    ? redisConfig.replace(/:([^@]+)@/, ':****@')
    : { ...redisConfig, password: '****' };

  logger.info('Redis connection established', {
    config: maskedConfig,
    status: 'connected'
  });
});

redis.on('ready', () => {
  logger.info('Redis client is ready to accept commands');
  
  // Check maxmemory-policy
  redis.config('GET', 'maxmemory-policy').then((result) => {
    // result is usually array: ['maxmemory-policy', 'volatile-lru']
    const policy = result[1];
    if (policy === 'volatile-lru' || policy === 'allkeys-lru') {
       logger.warn(`Redis maxmemory-policy is set to '${policy}'. It is recommended to use 'noeviction' to prevent job loss.`);
       // Optionally try to set it if allowed (often not allowed in managed instances)
       // redis.config('SET', 'maxmemory-policy', 'noeviction').catch(e => logger.warn('Could not set redis config:', e.message));
    }
  }).catch(err => {
     // Ignore config get errors (e.g. if command renamed or restricted)
     logger.debug('Could not check redis config', { error: err.message });
  });
});

redis.on('error', (err) => {
  logger.error('Redis connection error', {
    error: err.message,
    stack: err.stack
  });
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', (time) => {
  logger.warn('Redis reconnecting...', {
    delay: time
  });
});

module.exports = redis;
