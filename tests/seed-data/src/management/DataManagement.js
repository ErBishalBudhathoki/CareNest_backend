/**
 * DataManagement - Manages seed data cleanup and reset operations
 * 
 * Responsibilities:
 * - Clean up seed data from database
 * - Reset database to clean state
 * - Report data status
 * - Ensure production data safety
 * - Handle selective cleanup by phase or entity type
 */

import { MongoClient } from 'mongodb';
import logger from '../utils/logger.js';
import configManager from '../config/ConfigurationManager.js';
import { relationshipRules, getEntityOrder } from '../relationships/relationshipRules.js';

class DataManagement {
  constructor(options = {}) {
    this.environment = options.environment || 'development';
    this.mongoUri = options.mongoUri || null;
    this.dbClient = null;
    this.db = null;
    this.dryRun = options.dryRun || false;
    
    this.stats = {
      deleted: 0,
      preserved: 0,
      failed: 0,
      byType: {}
    };
  }

  /**
   * Clean up seed data from database
   * @param {Object} options - Cleanup options
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanup(options = {}) {
    try {
      logger.info('Starting seed data cleanup...', {
        environment: this.environment,
        dryRun: this.dryRun,
        ...options
      });

      // Load environment config
      const envConfig = await configManager.loadEnvironmentConfig(this.environment);

      // Safety check for production-like environments
      if (envConfig.isProduction && !options.force) {
        throw new Error(
          'Cannot cleanup in production-like environment without force flag. ' +
          'Use --force to override this safety check.'
        );
      }

      // Connect to database if not already connected
      if (!this.dbClient) {
        await this._connectDatabase(envConfig);
      }

      // Determine what to clean up
      const entityTypes = this._getEntityTypesToCleanup(options);

      // Clean up entities in correct order (respect foreign keys)
      const deletionOrder = this._getDeletionOrder(entityTypes);

      for (const entityType of deletionOrder) {
        await this._cleanupEntityType(entityType, options);
      }

      logger.info('Seed data cleanup complete', this.stats);

      return {
        success: true,
        stats: this.stats,
        dryRun: this.dryRun
      };
    } catch (error) {
      logger.error('Seed data cleanup failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Reset database to clean state
   * @param {Object} options - Reset options
   * @returns {Promise<Object>} Reset results
   */
  async reset(options = {}) {
    try {
      logger.info('Starting database reset...', {
        environment: this.environment,
        dryRun: this.dryRun
      });

      // Load environment config
      const envConfig = await configManager.loadEnvironmentConfig(this.environment);

      // Safety check for production-like environments
      if (envConfig.isProduction) {
        throw new Error(
          'Cannot reset production-like environment. ' +
          'This operation is only allowed in development and staging.'
        );
      }

      // Require confirmation for destructive operations
      if (!options.confirmed && !this.dryRun) {
        throw new Error(
          'Reset operation requires confirmation. ' +
          'Use --confirm flag to proceed with database reset.'
        );
      }

      // Connect to database if not already connected
      if (!this.dbClient) {
        await this._connectDatabase(envConfig);
      }

      // Get all entity types
      const allEntityTypes = this._getAllEntityTypes();

      // Delete all entities in correct order
      const deletionOrder = this._getDeletionOrder(allEntityTypes);

      for (const entityType of deletionOrder) {
        await this._deleteAllEntities(entityType);
      }

      logger.info('Database reset complete', this.stats);

      return {
        success: true,
        stats: this.stats,
        dryRun: this.dryRun
      };
    } catch (error) {
      logger.error('Database reset failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get status of seed data in database
   * @returns {Promise<Object>} Status information
   */
  async getStatus() {
    try {
      logger.info('Getting seed data status...');

      // Load environment config
      const envConfig = await configManager.loadEnvironmentConfig(this.environment);

      // Connect to database if not already connected
      if (!this.dbClient) {
        await this._connectDatabase(envConfig);
      }

      const status = {
        environment: this.environment,
        timestamp: new Date().toISOString(),
        entities: {},
        summary: {
          totalSeedData: 0,
          totalProduction: 0,
          totalEntities: 0
        }
      };

      // Get all entity types
      const allEntityTypes = this._getAllEntityTypes();

      // Count entities for each type
      for (const entityType of allEntityTypes) {
        const counts = await this._getEntityCounts(entityType);
        status.entities[entityType] = counts;
        status.summary.totalSeedData += counts.seedData;
        status.summary.totalProduction += counts.production;
        status.summary.totalEntities += counts.total;
      }

      // Get last generation and cleanup times
      status.lastGeneration = await this._getLastGenerationTime();
      status.lastCleanup = await this._getLastCleanupTime();

      logger.info('Status retrieved successfully', status.summary);

      return status;
    } catch (error) {
      logger.error('Failed to get status', { error: error.message });
      throw error;
    }
  }

  /**
   * Clean up specific entity type
   * @private
   */
  async _cleanupEntityType(entityType, options = {}) {
    try {
      logger.info(`Cleaning up ${entityType}...`);

      // Build query to find seed data
      const query = { isSeedData: true };

      // Add additional filters if specified
      if (options.phase) {
        query.phase = options.phase;
      }

      if (options.olderThan) {
        query.createdAt = { $lt: new Date(options.olderThan) };
      }

      // Count entities to delete
      const count = await this._countEntities(entityType, query);

      if (count === 0) {
        logger.info(`No ${entityType} entities to clean up`);
        return;
      }

      logger.info(`Found ${count} ${entityType} entities to delete`);

      if (this.dryRun) {
        logger.info(`[DRY RUN] Would delete ${count} ${entityType} entities`);
        this.stats.deleted += count;
        this.stats.byType[entityType] = { deleted: count, failed: 0 };
        return;
      }

      // Delete entities
      let deleted = 0;
      let failed = 0;

      try {
        const result = await this._deleteEntities(entityType, query);
        deleted = result.deletedCount || 0;
        
        if (deleted !== count) {
          failed = count - deleted;
          logger.warn(`Expected to delete ${count} but deleted ${deleted}`);
        }
      } catch (error) {
        logger.error(`Failed to delete ${entityType}`, { error: error.message });
        failed = count;
        
        // Continue on failure if specified
        if (!options.continueOnError) {
          throw error;
        }
      }

      // Update stats
      this.stats.deleted += deleted;
      this.stats.failed += failed;
      this.stats.byType[entityType] = { deleted, failed };

      logger.info(`Cleaned up ${deleted}/${count} ${entityType} entities`);
    } catch (error) {
      logger.error(`Cleanup failed for ${entityType}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Delete all entities of a type (for reset)
   * @private
   */
  async _deleteAllEntities(entityType) {
    try {
      logger.info(`Deleting all ${entityType}...`);

      const count = await this._countEntities(entityType, {});

      if (count === 0) {
        logger.info(`No ${entityType} entities to delete`);
        return;
      }

      if (this.dryRun) {
        logger.info(`[DRY RUN] Would delete ${count} ${entityType} entities`);
        this.stats.deleted += count;
        return;
      }

      const result = await this._deleteEntities(entityType, {});
      const deleted = result.deletedCount || 0;

      this.stats.deleted += deleted;
      this.stats.byType[entityType] = { deleted, failed: 0 };

      logger.info(`Deleted ${deleted} ${entityType} entities`);
    } catch (error) {
      logger.error(`Failed to delete all ${entityType}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Get entity types to cleanup based on options
   * @private
   */
  _getEntityTypesToCleanup(options) {
    if (options.entityType) {
      // Specific entity type
      return [options.entityType];
    }

    if (options.phase) {
      // All entity types in a phase
      return this._getEntityTypesForPhase(options.phase);
    }

    // All entity types
    return this._getAllEntityTypes();
  }

  /**
   * Get deletion order (reverse of dependency order)
   * @private
   */
  _getDeletionOrder(entityTypes) {
    // Get entity order from relationship rules
    const order = getEntityOrder();
    
    // Filter to only include requested entity types
    const filtered = order.filter(type => entityTypes.includes(type));
    
    // Reverse order for deletion (delete dependents first)
    return filtered.reverse();
  }

  /**
   * Get all entity types
   * @private
   */
  _getAllEntityTypes() {
    return [
      'user',
      'organization',
      'client',
      'worker',
      'shift',
      'invoice',
      'carePlan',
      'medication',
      'incident',
      'timesheet',
      'expense',
      'complianceRecord',
      'appointment',
      'payment',
      'budget',
      'analyticsData',
      'notification',
      'message',
      'document',
      'auditLog'
    ];
  }

  /**
   * Get entity types for a specific phase
   * @private
   */
  _getEntityTypesForPhase(phase) {
    // This would be loaded from feature configs
    // For now, return a basic mapping
    const phaseMapping = {
      'financial-intelligence': ['invoice', 'payment', 'budget'],
      'care-intelligence': ['carePlan', 'medication', 'incident'],
      'workforce-optimization': ['worker', 'shift', 'timesheet'],
      'realtime-portal': ['message', 'notification'],
      'client-portal': ['client', 'appointment'],
      'payroll': ['timesheet', 'payment'],
      'offline-sync': [],
      'compliance': ['complianceRecord', 'auditLog'],
      'expenses': ['expense'],
      'scheduling': ['shift', 'appointment'],
      'analytics': ['analyticsData']
    };

    return phaseMapping[phase] || [];
  }

  /**
   * Get entity counts
   * @private
   */
  async _getEntityCounts(entityType) {
    try {
      const total = await this._countEntities(entityType, {});
      const seedData = await this._countEntities(entityType, { isSeedData: true });
      const production = total - seedData;

      return {
        total,
        seedData,
        production
      };
    } catch (error) {
      logger.error(`Failed to count ${entityType}`, { error: error.message });
      return { total: 0, seedData: 0, production: 0 };
    }
  }

  /**
   * Database operation methods
   * @private
   */
  async _connectDatabase(envConfig) {
    const connectionString = this.mongoUri || envConfig.database?.connectionString;
    
    if (!connectionString) {
      throw new Error('No database connection string provided');
    }
    
    logger.info('Connecting to database...', {
      connectionString: connectionString.substring(0, 50) + '...'
    });
    
    this.dbClient = new MongoClient(connectionString);
    await this.dbClient.connect();
    
    const dbName = envConfig.database?.name || 'Invoice';
    this.db = this.dbClient.db(dbName);
    
    logger.info(`Connected to database: ${dbName}`);
  }

  async _countEntities(entityType, query) {
    if (!this.db) return 0;
    
    try {
      const collection = this.db.collection(entityType);
      return await collection.countDocuments(query);
    } catch (error) {
      logger.debug(`Collection ${entityType} may not exist`);
      return 0;
    }
  }

  async _deleteEntities(entityType, query) {
    if (!this.db) return { deletedCount: 0 };
    
    try {
      const collection = this.db.collection(entityType);
      const result = await collection.deleteMany(query);
      return { deletedCount: result.deletedCount };
    } catch (error) {
      logger.error(`Failed to delete from ${entityType}`, { error: error.message });
      return { deletedCount: 0 };
    }
  }

  async _getLastGenerationTime() {
    return null;
  }

  async _getLastCleanupTime() {
    return null;
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.dbClient) {
      logger.info('Closing database connection...');
      await this.dbClient.close();
      this.dbClient = null;
      this.db = null;
    }
  }

  /**
   * Get cleanup statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return this.stats;
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      deleted: 0,
      preserved: 0,
      failed: 0,
      byType: {}
    };
  }
}

export default DataManagement;
