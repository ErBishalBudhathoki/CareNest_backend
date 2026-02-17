import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ConfigurationManager - Manages environment, feature, and volume configurations
 * 
 * Responsibilities:
 * - Load environment-specific configurations
 * - Load feature phase configurations
 * - Load volume preset configurations
 * - Validate configuration integrity
 * - Substitute environment variables in config values
 */
class ConfigurationManager {
  constructor() {
    this.configRoot = path.join(__dirname, '../../config');
    this.environmentsPath = path.join(this.configRoot, 'environments');
    this.featuresPath = path.join(this.configRoot, 'features');
    this.volumesPath = path.join(this.configRoot, 'volumes');
    
    // Cache loaded configurations
    this.cache = {
      environments: new Map(),
      features: new Map(),
      volumes: new Map(),
    };
  }

  /**
   * Load environment configuration
   * @param {string} environment - Environment name (development, staging, production-like)
   * @returns {Promise<Object>} Environment configuration
   */
  async loadEnvironmentConfig(environment) {
    try {
      // Check cache first
      if (this.cache.environments.has(environment)) {
        logger.debug(`Using cached environment config for: ${environment}`);
        return this.cache.environments.get(environment);
      }

      const configPath = path.join(this.environmentsPath, `${environment}.json`);
      logger.info(`Loading environment config from: ${configPath}`);

      const configData = await fs.readFile(configPath, 'utf-8');
      let config = JSON.parse(configData);

      // Substitute environment variables
      config = this._substituteEnvVars(config);

      // Validate environment config
      this._validateEnvironmentConfig(config);

      // Cache the config
      this.cache.environments.set(environment, config);

      logger.info(`Successfully loaded environment config: ${environment}`);
      return config;
    } catch (error) {
      logger.error(`Failed to load environment config: ${environment}`, { error: error.message });
      throw new Error(`Failed to load environment configuration '${environment}': ${error.message}`);
    }
  }

  /**
   * Load feature phase configuration
   * @param {string} phase - Feature phase name or 'all'
   * @returns {Promise<Object|Array>} Feature configuration(s)
   */
  async loadFeatureConfig(phase) {
    try {
      if (phase === 'all') {
        return await this._loadAllFeatureConfigs();
      }

      // Check cache first
      if (this.cache.features.has(phase)) {
        logger.debug(`Using cached feature config for: ${phase}`);
        return this.cache.features.get(phase);
      }

      const configPath = path.join(this.featuresPath, `${phase}.json`);
      logger.info(`Loading feature config from: ${configPath}`);

      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);

      // Validate feature config
      this._validateFeatureConfig(config);

      // Cache the config
      this.cache.features.set(phase, config);

      logger.info(`Successfully loaded feature config: ${phase}`);
      return config;
    } catch (error) {
      logger.error(`Failed to load feature config: ${phase}`, { error: error.message });
      throw new Error(`Failed to load feature configuration '${phase}': ${error.message}`);
    }
  }

  /**
   * Load volume preset configuration
   * @param {string} preset - Volume preset name (small, medium, large) or path to custom file
   * @returns {Promise<Object>} Volume configuration
   */
  async loadVolumeConfig(preset) {
    try {
      // Check if it's a custom file path
      if (preset.endsWith('.json')) {
        return await this._loadCustomVolumeConfig(preset);
      }

      // Check cache first
      if (this.cache.volumes.has(preset)) {
        logger.debug(`Using cached volume config for: ${preset}`);
        return this.cache.volumes.get(preset);
      }

      const configPath = path.join(this.volumesPath, `${preset}.json`);
      logger.info(`Loading volume config from: ${configPath}`);

      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);

      // Validate volume config
      this._validateVolumeConfig(config);

      // Cache the config
      this.cache.volumes.set(preset, config);

      logger.info(`Successfully loaded volume config: ${preset}`);
      return config;
    } catch (error) {
      logger.error(`Failed to load volume config: ${preset}`, { error: error.message });
      throw new Error(`Failed to load volume configuration '${preset}': ${error.message}`);
    }
  }

  /**
   * Validate all configuration files
   * @returns {Promise<Object>} Validation results
   */
  async validateConfig() {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
    };

    try {
      // Validate environment configs
      const envFiles = await fs.readdir(this.environmentsPath);
      for (const file of envFiles.filter(f => f.endsWith('.json'))) {
        try {
          const env = file.replace('.json', '');
          await this.loadEnvironmentConfig(env);
        } catch (error) {
          results.valid = false;
          results.errors.push(`Environment config '${file}': ${error.message}`);
        }
      }

      // Validate feature configs
      try {
        const featureFiles = await fs.readdir(this.featuresPath);
        for (const file of featureFiles.filter(f => f.endsWith('.json'))) {
          try {
            const phase = file.replace('.json', '');
            await this.loadFeatureConfig(phase);
          } catch (error) {
            results.valid = false;
            results.errors.push(`Feature config '${file}': ${error.message}`);
          }
        }
      } catch (error) {
        // Features directory might not exist yet
        results.warnings.push('Features directory not found - will be created during setup');
      }

      // Validate volume configs
      const volumeFiles = await fs.readdir(this.volumesPath);
      for (const file of volumeFiles.filter(f => f.endsWith('.json'))) {
        try {
          const preset = file.replace('.json', '');
          await this.loadVolumeConfig(preset);
        } catch (error) {
          results.valid = false;
          results.errors.push(`Volume config '${file}': ${error.message}`);
        }
      }

      logger.info('Configuration validation complete', {
        valid: results.valid,
        errorCount: results.errors.length,
        warningCount: results.warnings.length,
      });

      return results;
    } catch (error) {
      logger.error('Configuration validation failed', { error: error.message });
      results.valid = false;
      results.errors.push(`Validation error: ${error.message}`);
      return results;
    }
  }

  /**
   * Clear configuration cache
   */
  clearCache() {
    this.cache.environments.clear();
    this.cache.features.clear();
    this.cache.volumes.clear();
    logger.info('Configuration cache cleared');
  }

  // Private helper methods

  /**
   * Load all feature configurations
   * @private
   */
  async _loadAllFeatureConfigs() {
    try {
      const featureFiles = await fs.readdir(this.featuresPath);
      const configs = [];

      for (const file of featureFiles.filter(f => f.endsWith('.json'))) {
        const phase = file.replace('.json', '');
        const config = await this.loadFeatureConfig(phase);
        configs.push(config);
      }

      logger.info(`Loaded ${configs.length} feature configurations`);
      return configs;
    } catch (error) {
      // If features directory doesn't exist, return empty array
      logger.warn('Features directory not found, returning empty array');
      return [];
    }
  }

  /**
   * Load custom volume configuration from file path
   * @private
   */
  async _loadCustomVolumeConfig(filePath) {
    try {
      logger.info(`Loading custom volume config from: ${filePath}`);
      const configData = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(configData);
      
      // Validate custom volume config
      this._validateVolumeConfig(config);
      
      return config;
    } catch (error) {
      throw new Error(`Failed to load custom volume configuration: ${error.message}`);
    }
  }

  /**
   * Substitute environment variables in configuration values
   * @private
   */
  _substituteEnvVars(obj) {
    if (typeof obj === 'string') {
      // Replace ${VAR_NAME} with environment variable value
      return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
        const value = process.env[varName];
        if (value === undefined) {
          logger.warn(`Environment variable not found: ${varName}`);
          return match; // Keep original if not found
        }
        return value;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._substituteEnvVars(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this._substituteEnvVars(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Validate environment configuration structure
   * @private
   */
  _validateEnvironmentConfig(config) {
    const required = ['name', 'apiBaseUrl', 'database'];
    const missing = required.filter(field => !config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required fields in environment config: ${missing.join(', ')}`);
    }

    if (!config.database.connectionString) {
      throw new Error('Missing database.connectionString in environment config');
    }

    if (!config.database.name) {
      throw new Error('Missing database.name in environment config');
    }

    // Validate URL format
    try {
      new URL(config.apiBaseUrl);
    } catch (error) {
      throw new Error(`Invalid apiBaseUrl format: ${config.apiBaseUrl}`);
    }
  }

  /**
   * Validate feature configuration structure
   * @private
   */
  _validateFeatureConfig(config) {
    const required = ['phaseName', 'entities'];
    const missing = required.filter(field => !config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required fields in feature config: ${missing.join(', ')}`);
    }

    if (!Array.isArray(config.entities)) {
      throw new Error('Feature config entities must be an array');
    }

    if (config.dependencies && !Array.isArray(config.dependencies)) {
      throw new Error('Feature config dependencies must be an array');
    }
  }

  /**
   * Validate volume configuration structure
   * @private
   */
  _validateVolumeConfig(config) {
    const required = ['preset', 'entityCounts'];
    const missing = required.filter(field => !config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required fields in volume config: ${missing.join(', ')}`);
    }

    if (typeof config.entityCounts !== 'object' || config.entityCounts === null) {
      throw new Error('Volume config entityCounts must be an object');
    }

    // Validate entity counts are positive numbers
    for (const [entity, count] of Object.entries(config.entityCounts)) {
      if (typeof count !== 'number' || count < 0) {
        throw new Error(`Invalid entity count for '${entity}': must be a positive number`);
      }
    }

    if (config.relationshipDensity !== undefined) {
      if (typeof config.relationshipDensity !== 'number' || 
          config.relationshipDensity < 0 || 
          config.relationshipDensity > 1) {
        throw new Error('relationshipDensity must be a number between 0 and 1');
      }
    }
  }
}

export { ConfigurationManager };
export default new ConfigurationManager();
