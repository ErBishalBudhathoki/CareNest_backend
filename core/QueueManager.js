const { Queue, Worker } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../config/logger');

class QueueManager {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.redisEnabled = redis.isConfigured !== false;
    // Use connection options with proper timeouts for BullMQ
    this.connection = this.redisEnabled ? {
      ...redis.options,
      ...redis.connectionOptions,
      maxRetriesPerRequest: null
    } : null;

    if (!this.redisEnabled) {
      logger.warn('QueueManager is disabled because Redis is not configured');
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
      this.queues[name] = new Queue(name, { connection: this.connection });
      logger.info(`Queue initialized: ${name}`);
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

    const queue = this.getQueue(queueName);
    if (!queue) {
      return null;
    }
    return await queue.add(jobName, data, opts);
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

    this.workers[queueName] = new Worker(queueName, async (job) => {
      logger.info(`Processing job ${job.name} in ${queueName}`);
      try {
        await processor(job);
        logger.info(`Job ${job.name} completed`);
      } catch (error) {
        logger.error(`Job ${job.name} failed`, error);
        throw error;
      }
    }, { connection: this.connection });

    logger.info(`Worker registered for ${queueName}`);
  }
}

module.exports = new QueueManager();
