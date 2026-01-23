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
