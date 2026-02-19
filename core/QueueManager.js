const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../config/logger');

class QueueManager {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.redisEnabled = redis.isConfigured !== false && redis.status !== 'circuit-open';
    this.connection = null;

    if (!this.redisEnabled) {
      logger.warn('QueueManager is disabled because Redis is unavailable');
    } else {
      // Build connection options for BullMQ
      const baseOptions = redis.connectionOptions || {};
      this.connection = {
        host: redis.options?.host,
        port: redis.options?.port,
        ...baseOptions,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        // Increase timeouts for remote Redis
        connectTimeout: 15000,
        commandTimeout: 10000,
      };
      
      // If using URL, extract host/port
      if (redis.redisUrl) {
        try {
          const url = new URL(redis.redisUrl.replace('redis://', 'http://'));
          this.connection.host = url.hostname;
          this.connection.port = url.port || 6379;
          if (url.password) {
            this.connection.password = url.password;
          }
        } catch {
          // Fallback to options
        }
      }
    }
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
              delay: 1000
            }
          }
        });
        
        this.queues[name].on('error', (err) => {
          logger.error(`Queue ${name} error`, { error: err.message });
        });
        
        logger.info(`Queue initialized: ${name}`);
      } catch (err) {
        logger.error(`Failed to initialize queue ${name}`, { error: err.message });
        this.redisEnabled = false;
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
      logger.warn(`Skipped job enqueue for ${queueName}/${jobName} because Redis is unavailable`);
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
      logger.warn(`Skipped worker registration for ${queueName} because Redis is unavailable`);
      return;
    }

    if (this.workers[queueName]) {
      logger.warn(`Worker for ${queueName} already exists`);
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
        autorun: true
      });

      this.workers[queueName].on('error', (err) => {
        logger.error(`Worker ${queueName} error`, { error: err.message });
        // If too many errors, disable queue
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
          logger.error(`Disabling queue ${queueName} due to connection errors`);
          this.redisEnabled = false;
        }
      });

      logger.info(`Worker registered for ${queueName}`);
    } catch (err) {
      logger.error(`Failed to register worker for ${queueName}`, { error: err.message });
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
