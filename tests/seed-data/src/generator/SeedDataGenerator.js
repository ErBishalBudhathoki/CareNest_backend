/**
 * SeedDataGenerator - Generates seed data for testing
 * 
 * Responsibilities:
 * - Generate entities based on configuration
 * - Handle phase-specific generation
 * - Support volume-based generation
 * - Implement incremental generation
 * - Validate generated data
 * - Handle errors and retries
 */

import logger from '../utils/logger.js';
import configManager from '../config/ConfigurationManager.js';
import { getInstance as getFactoryRegistry } from '../factories/FactoryRegistry.js';
import { registerAllFactories } from '../factories/index.js';
import RelationshipBuilder from '../relationships/RelationshipBuilder.js';
import { relationshipRules } from '../relationships/relationshipRules.js';
import DataValidator from '../validation/DataValidator.js';
import { validationRules } from '../validation/validationRules.js';
import { MongoClient } from 'mongodb';

class SeedDataGenerator {
  constructor(options = {}) {
    this.environment = options.environment || 'development';
    this.phases = options.phases || 'all';
    this.volumePreset = options.volumePreset || 'small';
    this.incremental = options.incremental || false;
    this.maxRetries = options.maxRetries || 3;
    this.mongoUri = options.mongoUri || null;
    this.dbClient = null;
    this.db = null;
    
    this.factoryRegistry = getFactoryRegistry();
    registerAllFactories(this.factoryRegistry);
    this.relationshipBuilder = new RelationshipBuilder(relationshipRules);
    this.validator = new DataValidator(validationRules);
    
    this.generatedData = {};
    this.stats = {
      total: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      byType: {}
    };
  }

  /**
   * Generate seed data
   * @returns {Promise<Object>} Generated data and statistics
   */
  async generate() {
    try {
      logger.info('Starting seed data generation...', {
        environment: this.environment,
        phases: this.phases,
        volumePreset: this.volumePreset,
        incremental: this.incremental
      });

      await this._loadConfigurations();

      if (this.incremental) {
        await this.generateIncremental();
      } else {
        await this._generateFresh();
      }

      logger.info('Building relationships between entities...');
      this.generatedData = this.relationshipBuilder.buildRelationships(this.generatedData);

      await this.validateData();

      const saveResult = await this.saveToDatabase();

      logger.info('Seed data generation complete', this.stats);

      return {
        data: this.generatedData,
        stats: this.stats,
        savedToDb: saveResult
      };
    } catch (error) {
      logger.error('Seed data generation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate incremental seed data (add to existing data)
   * @returns {Promise<Object>} Generated data and statistics
   */
  async generateIncremental() {
    logger.info('Generating incremental seed data...');

    try {
      // Load existing entities from database
      const existingData = await this._loadExistingData();
      
      // Merge existing data into generatedData
      for (const [entityType, entities] of Object.entries(existingData)) {
        this.generatedData[entityType] = entities;
      }

      // Generate new entities
      const phasesToGenerate = this._getPhasesToGenerate();
      
      for (const phase of phasesToGenerate) {
        await this._generatePhaseIncremental(phase);
      }

      logger.info('Incremental generation complete');
      return {
        data: this.generatedData,
        stats: this.stats
      };
    } catch (error) {
      logger.error('Incremental generation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate all generated data
   * @returns {Promise<Object>} Validation results
   */
  async validateData() {
    logger.info('Validating generated data...');

    const validationResults = {
      valid: true,
      errors: [],
      warnings: []
    };

    for (const [entityType, entities] of Object.entries(this.generatedData)) {
      if (!Array.isArray(entities)) continue;

      const batchResult = this.validator.validateBatch(entityType, entities);
      
      if (!batchResult.valid) {
        validationResults.valid = false;
        validationResults.errors.push({
          entityType,
          summary: batchResult.summary,
          details: batchResult.results.filter(r => !r.valid)
        });
      }
    }

    // Validate referential integrity
    const integrityResult = this.relationshipBuilder.validateIntegrity(this.generatedData);
    if (!integrityResult.valid) {
      validationResults.valid = false;
      validationResults.errors.push({
        type: 'referential_integrity',
        errors: integrityResult.errors
      });
    }

    if (validationResults.valid) {
      logger.info('All data validation passed');
    } else {
      logger.warn('Data validation found issues', {
        errorCount: validationResults.errors.length
      });
    }

    return validationResults;
  }

  /**
   * Load configurations
   * @private
   */
  async _loadConfigurations() {
    logger.info('Loading configurations...');

    // Load environment config
    this.envConfig = await configManager.loadEnvironmentConfig(this.environment);

    // Load feature configs
    if (this.phases === 'all') {
      this.featureConfigs = await configManager.loadFeatureConfig('all');
    } else {
      const phaseList = Array.isArray(this.phases) ? this.phases : [this.phases];
      this.featureConfigs = [];
      for (const phase of phaseList) {
        const config = await configManager.loadFeatureConfig(phase);
        this.featureConfigs.push(config);
      }
    }

    // Load volume config
    this.volumeConfig = await configManager.loadVolumeConfig(this.volumePreset);

    logger.info('Configurations loaded successfully');
  }

  /**
   * Generate fresh seed data (no existing data)
   * @private
   */
  async _generateFresh() {
    logger.info('Generating fresh seed data...');

    const phasesToGenerate = this._getPhasesToGenerate();

    for (const phase of phasesToGenerate) {
      await this._generatePhase(phase);
    }
  }

  /**
   * Get phases to generate based on configuration
   * @private
   */
  _getPhasesToGenerate() {
    if (this.phases === 'all') {
      return this.featureConfigs;
    }

    return this.featureConfigs;
  }

  /**
   * Generate entities for a single phase
   * @private
   */
  async _generatePhase(phaseConfig) {
    const phaseName = phaseConfig.phaseName;
    logger.info(`Generating phase: ${phaseName}`);

    // Check phase dependencies
    if (phaseConfig.dependencies && phaseConfig.dependencies.length > 0) {
      await this._ensureDependencies(phaseConfig.dependencies);
    }

    // Generate entities for this phase
    for (const entityType of phaseConfig.entities) {
      await this._generateEntities(entityType, phaseName);
    }

    logger.info(`Phase ${phaseName} generation complete`);
  }

  /**
   * Generate entities for a phase incrementally
   * @private
   */
  async _generatePhaseIncremental(phaseConfig) {
    const phaseName = phaseConfig.phaseName;
    logger.info(`Generating phase incrementally: ${phaseName}`);

    // Generate entities for this phase
    for (const entityType of phaseConfig.entities) {
      await this._generateEntitiesIncremental(entityType, phaseName);
    }

    logger.info(`Incremental phase ${phaseName} generation complete`);
  }

  /**
   * Generate entities of a specific type
   * @private
   */
  async _generateEntities(entityType, phaseName) {
    try {
      // Get count from volume config
      const count = this.volumeConfig.entityCounts[entityType] || 0;
      
      if (count === 0) {
        logger.debug(`Skipping ${entityType} (count = 0)`);
        this.stats.skipped++;
        return;
      }

      logger.info(`Generating ${count} ${entityType} entities...`);

      // Check if factory exists
      if (!this.factoryRegistry.has(entityType)) {
        logger.warn(`No factory found for ${entityType}, skipping`);
        this.stats.skipped += count;
        return;
      }

      const entities = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < count; i++) {
        const entity = await this._generateEntityWithRetry(entityType);
        
        if (entity) {
          entities.push(entity);
          successCount++;
        } else {
          failCount++;
        }

        // Progress indicator for large datasets
        if ((i + 1) % 100 === 0) {
          logger.info(`Progress: ${i + 1}/${count} ${entityType} entities generated`);
        }
      }

      // Store generated entities
      this.generatedData[entityType] = entities;

      // Update stats
      this.stats.total += count;
      this.stats.successful += successCount;
      this.stats.failed += failCount;
      this.stats.byType[entityType] = {
        total: count,
        successful: successCount,
        failed: failCount
      };

      logger.info(`Generated ${successCount}/${count} ${entityType} entities`);
    } catch (error) {
      logger.error(`Failed to generate ${entityType}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Generate entities incrementally
   * @private
   */
  async _generateEntitiesIncremental(entityType, phaseName) {
    try {
      // Get count from volume config
      const count = this.volumeConfig.entityCounts[entityType] || 0;
      
      if (count === 0) {
        logger.debug(`Skipping ${entityType} (count = 0)`);
        return;
      }

      // Get existing entities
      const existing = this.generatedData[entityType] || [];
      const existingCount = existing.length;

      // Calculate how many new entities to create
      const newCount = Math.max(0, count - existingCount);

      if (newCount === 0) {
        logger.info(`${entityType}: Already have ${existingCount} entities, skipping`);
        return;
      }

      logger.info(`Generating ${newCount} additional ${entityType} entities (existing: ${existingCount})...`);

      // Check if factory exists
      if (!this.factoryRegistry.has(entityType)) {
        logger.warn(`No factory found for ${entityType}, skipping`);
        return;
      }

      const newEntities = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < newCount; i++) {
        const entity = await this._generateEntityWithRetry(entityType);
        
        if (entity) {
          newEntities.push(entity);
          successCount++;
        } else {
          failCount++;
        }
      }

      // Append new entities to existing
      this.generatedData[entityType] = [...existing, ...newEntities];

      // Update stats
      this.stats.total += newCount;
      this.stats.successful += successCount;
      this.stats.failed += failCount;
      this.stats.byType[entityType] = {
        total: newCount,
        successful: successCount,
        failed: failCount
      };

      logger.info(`Generated ${successCount}/${newCount} new ${entityType} entities`);
    } catch (error) {
      logger.error(`Failed to generate ${entityType} incrementally`, { error: error.message });
      throw error;
    }
  }

  /**
   * Generate a single entity with retry logic
   * @private
   */
  async _generateEntityWithRetry(entityType) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Generate entity
        const entity = this.factoryRegistry.create(entityType);

        // Validate entity
        const validation = this.validator.validate(entityType, entity);
        
        if (validation.valid) {
          return entity;
        } else {
          lastError = new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
          logger.debug(`Validation failed for ${entityType}, attempt ${attempt}/${this.maxRetries}`);
        }
      } catch (error) {
        lastError = error;
        logger.debug(`Generation failed for ${entityType}, attempt ${attempt}/${this.maxRetries}`, {
          error: error.message
        });
      }
    }

    logger.error(`Failed to generate ${entityType} after ${this.maxRetries} attempts`, {
      error: lastError?.message
    });
    
    return null;
  }

  /**
   * Ensure phase dependencies are satisfied
   * @private
   */
  async _ensureDependencies(dependencies) {
    for (const dep of dependencies) {
      const depConfig = this.featureConfigs.find(c => c.phaseName === dep);
      
      if (!depConfig) {
        throw new Error(`Dependency phase not found: ${dep}`);
      }

      // Check if dependency entities exist
      const hasAllDeps = depConfig.entities.every(entityType => {
        return this.generatedData[entityType] && this.generatedData[entityType].length > 0;
      });

      if (!hasAllDeps) {
        logger.info(`Generating dependency phase: ${dep}`);
        await this._generatePhase(depConfig);
      }
    }
  }

  /**
   * Load existing data from database (for incremental generation)
   * @private
   */
  async _loadExistingData() {
    // TODO: Implement database loading
    // For now, return empty object
    logger.info('Loading existing data from database...');
    
    // This will be implemented when we add database connectivity
    return {};
  }

  /**
   * Get generation statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return this.stats;
  }

  /**
   * Get generated data
   * @returns {Object} Generated entities
   */
  getData() {
    return this.generatedData;
  }

  /**
   * Initialize the generator (connect to database, etc.)
   */
  async initialize() {
    logger.info('Initializing seed data generator...');
    
    if (this.mongoUri) {
      try {
        logger.info('Connecting to database...', { connectionString: this.mongoUri.substring(0, 50) + '...' });
        this.dbClient = new MongoClient(this.mongoUri);
        await this.dbClient.connect();
        
        const envConfig = await configManager.loadEnvironmentConfig(this.environment);
        const dbName = envConfig.database?.name || 'Invoice';
        this.db = this.dbClient.db(dbName);
        logger.info(`Connected to database: ${dbName}`);
      } catch (error) {
        logger.error('Failed to connect to database', { error: error.message });
        throw error;
      }
    }
    
    return true;
  }

  /**
   * Cleanup resources (close connections, etc.)
   */
  async cleanup() {
    logger.info('Cleaning up seed data generator...');
    
    if (this.dbClient) {
      await this.dbClient.close();
      logger.info('Database connection closed');
    }
    
    return true;
  }

  /**
   * Save generated data to database
   */
  async saveToDatabase() {
    if (!this.db) {
      logger.warn('No database connection, skipping save');
      return { saved: false, reason: 'No database connection' };
    }

    logger.info('Saving generated data to database...');
    const savedCounts = {};

    for (const [entityType, entities] of Object.entries(this.generatedData)) {
      if (!Array.isArray(entities) || entities.length === 0) continue;

      try {
        // Map entity type to collection name
        let collectionName = entityType;
        if (entityType === 'auth') {
          collectionName = 'login'; // Auth data goes to login collection
        }

        const collection = this.db.collection(collectionName);
        const result = await collection.insertMany(entities);
        savedCounts[entityType] = result.insertedCount;
        logger.info(`Saved ${result.insertedCount} ${entityType} entities to ${collectionName} collection`);
      } catch (error) {
        logger.error(`Failed to save ${entityType} entities`, { error: error.message });
        savedCounts[entityType] = 0;
      }
    }

    return { saved: true, counts: savedCounts };
  }

  /**
   * Reset generator state
   */
  reset() {
    this.generatedData = {};
    this.stats = {
      total: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      byType: {}
    };
    logger.info('Generator state reset');
  }
}

export default SeedDataGenerator;
