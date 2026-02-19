const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../config/logger');

class QueueManager {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.redisEnabled = false;
    this.connection = null;
    this.initErrorCount = 0;
    this.maxInitErrors = 3;

    this._initialize();
  }

  _initialize() {
    // Check if Redis is configured and not in circuit-open state
    if (!redis.isConfigured) {
      logger.warn('QueueManager is disabled because Redis is not configured');
      return;
    }

    if (redis.status === 'circuit-open') {
      logger.warn('QueueManager is disabled because Redis circuit breaker is open');
      return;
    }

    // Build connection options for BullMQ
    // BullMQ uses its own ioredis, so we need to pass full connection config
    const connectionOptions = this._buildConnectionOptions();
    
    if (!connectionOptions) {
      logger.warn('QueueManager is disabled: could not build connection options');
      return;
    }

    this.connection = connectionOptions;
    this.redisEnabled = true;
    logger.info('QueueManager initialized with Redis connection');
  }

  _buildConnectionOptions() {
    const redisUrl = redis.redisUrl;
    
    if (redisUrl) {
      // Parse Redis URL: redis://[username:]password@host:port
      // Redis Cloud format: redis://default:PASSWORD@host:port
      try {
        // Handle redis:// and rediss:// URLs
        let urlToParse = redisUrl;
        if (redisUrl.startsWith('redis://')) {
          urlToParse = redisUrl.replace('redis://', 'http://');
        } else if (redisUrl.startsWith('rediss://')) {
          urlToParse = redisUrl.replace('rediss://', 'https://');
        }
        
        const parsed = new URL(urlToParse);
        
        const options = {
          host: parsed.hostname,
          port: parseInt(parsed.port, 10) || 6379,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          connectTimeout: 20000, // 20 seconds
          commandTimeout: 15000, // 15 seconds
          keepAlive: 10000,
        };
        
        // Handle authentication
        // Redis URL format: redis://username:password@host:port
        // or redis://:password@host:port (empty username)
        if (parsed.password) {
          options.password = decodeURIComponent(parsed.password);
        }
        
        // Username (if present, like 'default' in Redis Cloud)
        if (parsed.username && parsed.username !== 'default') {
          // Redis Cloud uses 'default' as username, which ioredis doesn't need
          // But if it's a different username, we might need it
          options.username = decodeURIComponent(parsed.username);
        }
        
        // TLS for rediss://
        if (redisUrl.startsWith('rediss://')) {
          options.tls = { rejectUnauthorized: false };
        }
        
        logger.info('QueueManager connection options built', {
          host: options.host,
          port: options.port,
          hasPassword: !!options.password,
          hasTls: !!options.tls
        });
        
        return options;
      } catch (err) {
        logger.error('Failed to parse Redis URL for QueueManager', { error: err.message });
        return null;
      }
    }
    
    // Fallback to redis.options if no URL
    if (redis.options) {
      return {
        host: redis.options.host,
        port: redis.options.port || 6379,
        password: redis.options.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        connectTimeout: 20000,
        commandTimeout: 15000,
        keepAlive: 10000,
      };
    }
    
    return null;
  }

  /**
   * Get or create a queue
   * @param {string} name - Queue name
   */
  getQueue(name) {
    if (!this.redisEnabled) {
      return null;
    }

    if (!this.queues[name]) {
      try {
        this.queues[name] = new Queue(name, { 
          connection: this.connection,
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000
            }
          }
        });
        
        this.queues[name].on('error', (err) => {
          this._handleQueueError(name, err);
        });
        
        logger.info(`Queue initialized: ${name}`);
      } catch (err) {
        logger.error(`Failed to initialize queue ${name}`, { error: err.message });
        this._handleInitError(err);
        return null;
      }
    }
    return this.queues[name];
  }

  /**
   * Add a job to a queue
   * @param {string} queueName 
   * @param {string} jobName 
   * @param {Object} data 
   * @param {Object} opts 
   */
  async addJob(queueName, jobName, data, opts = {}) {
    if (!this.redisEnabled) {
      logger.debug(`Skipped job enqueue for ${queueName}/${jobName} - Redis unavailable`);
      return null;
    }

    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        return null;
      }
      return await queue.add(jobName, data, opts);
    } catch (err) {
      logger.error(`Failed to add job ${queueName}/${jobName}`, { error: err.message });
      this._handleInitError(err);
      return null;
    }
  }

  /**
   * Register a worker for a queue
   * @param {string} queueName 
   * @param {Function} processor 
   */
  registerWorker(queueName, processor) {
    if (!this.redisEnabled) {
      logger.warn(`Skipped worker registration for ${queueName} - Redis unavailable`);
      return;
    }

    if (this.workers[queueName]) {
      logger.debug(`Worker for ${queueName} already exists`);
      return;
    }

    try {
      this.workers[queueName] = new Worker(queueName, async (job) => {
        logger.info(`Processing job ${job.name} in ${queueName}`);
        try {
          await processor(job);
          logger.info(`Job ${job.name} completed`);
        } catch (error) {
          logger.error(`Job ${job.name} failed`, { error: error.message });
          throw error;
        }
      }, { 
        connection: this.connection,
        autorun: true,
        settings: {
          stalledInterval: 30000,
          maxStalledCount: 1
        }
      });

      this.workers[queueName].on('error', (err) => {
        this._handleWorkerError(queueName, err);
      });

      logger.info(`Worker registered for ${queueName}`);
    } catch (err) {
      logger.error(`Failed to register worker for ${queueName}`, { error: err.message });
      this._handleInitError(err);
    }
  }

  _handleQueueError(queueName, err) {
    if (err.message.includes('ETIMEDOUT') || 
        err.message.includes('ECONNRESET') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('WRONGPASS')) {
      logger.error(`Queue ${queueName} connection error, disabling queues`, { error: err.message });
      this.redisEnabled = false;
    } else {
      logger.error(`Queue ${queueName} error`, { error: err.message });
    }
  }

  _handleWorkerError(queueName, err) {
    if (err.message.includes('ETIMEDOUT') || 
        err.message.includes('ECONNRESET') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('WRONGPASS')) {
      logger.error(`Worker ${queueName} connection error, disabling queues`, { error: err.message });
      this.redisEnabled = false;
    } else {
      logger.error(`Worker ${queueName} error`, { error: err.message });
    }
  }

  _handleInitError(err) {
    this.initErrorCount++;
    if (this.initErrorCount >= this.maxInitErrors) {
      logger.error('QueueManager: Too many initialization errors, disabling');
      this.redisEnabled = false;
    }
  }

  /**
   * Close all queues and workers
   */
  async closeAll() {
    const closePromises = [];
    
    for (const [name, worker] of Object.entries(this.workers)) {
      closePromises.push(
        worker.close().catch(err => 
          logger.error(`Failed to close worker ${name}`, { error: err.message })
        )
      );
    }
    
    for (const [name, queue] of Object.entries(this.queues)) {
      closePromises.push(
        queue.close().catch(err => 
          logger.error(`Failed to close queue ${name}`, { error: err.message })
        )
      );
    }
    
    await Promise.allSettled(closePromises);
    logger.info('All queues and workers closed');
  }
}

module.exports = new QueueManager();
