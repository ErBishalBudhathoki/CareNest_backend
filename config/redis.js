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
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 50, 2000)
  };
}

// Circuit breaker state
let connectionFailures = 0;
let circuitOpen = false;
let circuitOpenTime = 0;
const CIRCUIT_BREAK_THRESHOLD = 5;
const CIRCUIT_BREAK_RESET_MS = 60000; // 1 minute

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

class CircuitBreakerRedisClient extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.baseOptions = options;
    this.client = null;
    this.isConfigured = true;
    this.status = 'initializing';
    
    this._initializeClient();
  }

  _initializeClient() {
    // Check circuit breaker
    if (circuitOpen) {
      const elapsed = Date.now() - circuitOpenTime;
      if (elapsed < CIRCUIT_BREAK_RESET_MS) {
        logger.warn('Redis circuit breaker is open, using fallback');
        this.status = 'circuit-open';
        return;
      }
      // Try to reset circuit
      logger.info('Attempting to reset Redis circuit breaker');
      circuitOpen = false;
      connectionFailures = 0;
    }

    try {
      this.client = new RedisClass(this.url, this.baseOptions);
      
      this.client.on('connect', () => {
        this.status = 'connected';
        connectionFailures = 0;
        const maskedUrl = this.url.replace(/:([^@]+)@/, ':****@');
        logger.info('Redis connection established', { config: maskedUrl });
      });

      this.client.on('ready', () => {
        this.status = 'ready';
        logger.info('Redis client is ready to accept commands');
        
        this.client.config('GET', 'maxmemory-policy').then((result) => {
          const policy = result && result[1];
          if (policy && policy !== 'noeviction') {
            logger.info(`Redis maxmemory-policy is '${policy}'. For BullMQ, 'noeviction' is recommended.`);
          }
        }).catch(() => {});
      });

      this.client.on('error', (err) => {
        if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNRESET')) {
          connectionFailures++;
          logger.error('Redis connection error', { error: err.message, failures: connectionFailures });
          
          if (connectionFailures >= CIRCUIT_BREAK_THRESHOLD) {
            circuitOpen = true;
            circuitOpenTime = Date.now();
            logger.error('Redis circuit breaker opened due to repeated failures');
          }
        }
      });

      this.client.on('close', () => {
        this.status = 'disconnected';
        logger.warn('Redis connection closed');
      });

      this.client.on('reconnecting', (delay) => {
        this.status = 'reconnecting';
        logger.warn('Redis reconnecting...', { delay });
      });

    } catch (err) {
      logger.error('Failed to initialize Redis client', { error: err.message });
      this.status = 'error';
    }
  }

  get options() {
    return this.client?.options || {};
  }

  duplicate() {
    return new CircuitBreakerRedisClient(this.url, this.baseOptions);
  }

  async call(...args) {
    if (!this.client || circuitOpen) return null;
    try {
      return await this.client.call(...args);
    } catch (err) {
      this._handleCommandError(err);
      return null;
    }
  }

  async get(key) {
    if (!this.client || circuitOpen) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this._handleCommandError(err);
      return null;
    }
  }

  async set(key, value, ...args) {
    if (!this.client || circuitOpen) return 'OK';
    try {
      return await this.client.set(key, value, ...args);
    } catch (err) {
      this._handleCommandError(err);
      return 'OK';
    }
  }

  async del(...keys) {
    if (!this.client || circuitOpen) return 0;
    try {
      return await this.client.del(...keys);
    } catch (err) {
      this._handleCommandError(err);
      return 0;
    }
  }

  async exists(...keys) {
    if (!this.client || circuitOpen) return 0;
    try {
      return await this.client.exists(...keys);
    } catch (err) {
      this._handleCommandError(err);
      return 0;
    }
  }

  async scan(cursor, ...args) {
    if (!this.client || circuitOpen) return ['0', []];
    try {
      return await this.client.scan(cursor, ...args);
    } catch (err) {
      this._handleCommandError(err);
      return ['0', []];
    }
  }

  scanStream(...args) {
    if (!this.client || circuitOpen) {
      const stream = new EventEmitter();
      setImmediate(() => stream.emit('end'));
      return stream;
    }
    return this.client.scanStream(...args);
  }

  async publish(channel, message) {
    if (!this.client || circuitOpen) return 0;
    try {
      return await this.client.publish(channel, message);
    } catch (err) {
      this._handleCommandError(err);
      return 0;
    }
  }

  async subscribe(channel, callback) {
    if (!this.client || circuitOpen) {
      if (typeof callback === 'function') callback(null, 0);
      return 0;
    }
    try {
      return await this.client.subscribe(channel, callback);
    } catch (err) {
      this._handleCommandError(err);
      if (typeof callback === 'function') callback(null, 0);
      return 0;
    }
  }

  async quit() {
    if (this.client) {
      try {
        return await this.client.quit();
      } catch {
        return 'OK';
      }
    }
    return 'OK';
  }

  disconnect() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  _handleCommandError(err) {
    if (err.message.includes('timed out') || err.message.includes('ETIMEDOUT')) {
      connectionFailures++;
      if (connectionFailures >= CIRCUIT_BREAK_THRESHOLD) {
        circuitOpen = true;
        circuitOpenTime = Date.now();
        logger.error('Redis circuit breaker opened due to command timeouts');
      }
    }
    logger.warn('Redis command failed', { error: err.message });
  }
}

let redis;
if (!redisConfig) {
  logger.warn(
    'Redis is not configured. Redis-backed features will use in-memory or no-op behavior.',
    { isCloudRun, nodeEnv: process.env.NODE_ENV || 'development' }
  );
  redis = new DisabledRedisClient();
} else if (typeof redisConfig === 'string') {
  // Increased timeouts for Redis Cloud over internet
  const connectionOptions = {
    maxRetriesPerRequest: null,
    connectTimeout: 15000, // 15 seconds for connection
    commandTimeout: 10000, // 10 seconds for commands
    keepAlive: 10000, // Keep connection alive
    retryStrategy: (times) => {
      if (times > 3) {
        logger.error('Redis connection retry limit exceeded', { attempts: times });
        return null;
      }
      return Math.min(times * 2000, 10000);
    },
    tls: redisConfig.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
  };
  
  redis = new CircuitBreakerRedisClient(redisConfig, connectionOptions);
  redis.connectionOptions = connectionOptions;
  redis.redisUrl = redisConfig;
} else {
  const connectionOptions = {
    ...redisConfig,
    connectTimeout: 15000,
    commandTimeout: 10000,
    keepAlive: 10000
  };
  redis = new RedisClass(connectionOptions);
  redis.connectionOptions = connectionOptions;
  
  redis.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });
}

redis.isConfigured = Boolean(redisConfig);

module.exports = redis;
