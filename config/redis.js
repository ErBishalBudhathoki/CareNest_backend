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
  logger.info('Redis connected successfully');
});

redis.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

module.exports = redis;
