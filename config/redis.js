const EventEmitter = require('events');
const Redis = require('ioredis');
const logger = require('./logger');

// Check if we should use mock Redis (test only)
const useMockRedis = process.env.NODE_ENV === 'test';

let RedisClass = Redis;
if (useMockRedis) {
  try {
    RedisClass = require('ioredis-mock');
    logger.info('Using ioredis-mock for test environment');
  } catch (err) {
    logger.warn('ioredis-mock not found, falling back to real Redis');
  }
}

const isCloudRun = Boolean(process.env.K_SERVICE);
const hasRedisUrl = Boolean(process.env.REDIS_URL);
const hasRedisHostConfig = Boolean(
  process.env.REDIS_HOST || process.env.REDIS_PORT || process.env.REDIS_PASSWORD
);
const shouldUseLocalDefaults = !hasRedisUrl && !hasRedisHostConfig && !isCloudRun;

const parsedRedisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPort = Number.isNaN(parsedRedisPort) ? 6379 : parsedRedisPort;

let redisConfig = null;
if (hasRedisUrl) {
  redisConfig = process.env.REDIS_URL;
} else if (hasRedisHostConfig || shouldUseLocalDefaults) {
  redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: redisPort,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ compatibility
    retryStrategy: (times) => Math.min(times * 50, 2000)
  };
}

class DisabledRedisClient extends EventEmitter {
  constructor() {
    super();
    this.options = {};
    this.status = 'disabled';
    this.isConfigured = false;
  }

  duplicate() {
    return new DisabledRedisClient();
  }

  async call() {
    return null;
  }

  async get() {
    return null;
  }

  async set() {
    return 'OK';
  }

  async del() {
    return 0;
  }

  async exists() {
    return 0;
  }

  async scan() {
    return ['0', []];
  }

  scanStream() {
    const stream = new EventEmitter();
    setImmediate(() => stream.emit('end'));
    return stream;
  }

  async publish() {
    return 0;
  }

  async subscribe(_channel, callback) {
    if (typeof callback === 'function') {
      callback(null, 0);
    }
    return 0;
  }

  async config() {
    return ['maxmemory-policy', 'noeviction'];
  }

  async quit() {
    return 'OK';
  }

  disconnect() {}
}

let redis;
if (!redisConfig) {
  logger.warn(
    'Redis is not configured. Redis-backed features will use in-memory or no-op behavior.',
    { isCloudRun, nodeEnv: process.env.NODE_ENV || 'development' }
  );
  redis = new DisabledRedisClient();
} else if (typeof redisConfig === 'string') {
  // REDIS_URL supports redis:// and rediss:// (SSL)
  // Redis Cloud uses rediss:// for secure connections
  const connectionOptions = {
    maxRetriesPerRequest: null,
    connectTimeout: 10000, // 10 seconds timeout
    commandTimeout: 5000, // 5 seconds for commands
    retryStrategy: (times) => {
      if (times > 3) {
        logger.error('Redis connection retry limit exceeded', { attempts: times });
        return null; // Stop retrying
      }
      return Math.min(times * 1000, 3000);
    },
    tls: redisConfig.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
  };
  redis = new RedisClass(redisConfig, connectionOptions);
} else {
  redis = new RedisClass({
    ...redisConfig,
    connectTimeout: 10000,
    commandTimeout: 5000
  });
}

const redisConfigured = Boolean(redisConfig);
redis.isConfigured = redisConfigured;

if (redisConfigured) {
  redis.on('connect', () => {
    // Mask password in connection details log
    const maskedConfig = typeof redisConfig === 'string'
      ? redisConfig.replace(/:([^@]+)@/, ':****@')
      : { ...redisConfig, password: redisConfig.password ? '****' : undefined };

    logger.info('Redis connection established', {
      config: maskedConfig,
      status: 'connected'
    });
  });

  redis.on('ready', () => {
    logger.info('Redis client is ready to accept commands');

    // Check maxmemory-policy
    redis.config('GET', 'maxmemory-policy').then((result) => {
      const policy = result && result[1];
      if (policy && policy !== 'noeviction') {
        logger.info(`Redis maxmemory-policy is '${policy}'. For BullMQ job queues, 'noeviction' is recommended. Contact your Redis provider to change if needed.`);
      }
    }).catch((err) => {
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
}

module.exports = redis;
