/**
 * FactoryRegistry - Central registry for all entity factories
 * 
 * Manages registration and retrieval of entity factories
 */

import logger from '../utils/logger.js';

class FactoryRegistry {
  constructor() {
    this.factories = new Map();
  }

  /**
   * Register a factory
   * @param {string} entityType - Type of entity (e.g., 'user', 'client')
   * @param {EntityFactory} factory - Factory instance
   */
  register(entityType, factory) {
    if (!entityType) {
      throw new Error('Entity type is required');
    }

    if (!factory) {
      throw new Error('Factory instance is required');
    }

    if (this.factories.has(entityType)) {
      logger.warn(`Factory for ${entityType} already registered. Overwriting.`);
    }

    this.factories.set(entityType, factory);
    logger.debug(`Registered factory for: ${entityType}`);
  }

  /**
   * Get a factory by entity type
   * @param {string} entityType - Type of entity
   * @returns {EntityFactory} Factory instance
   */
  get(entityType) {
    const factory = this.factories.get(entityType);
    
    if (!factory) {
      throw new Error(`No factory registered for entity type: ${entityType}`);
    }

    return factory;
  }

  /**
   * Check if a factory is registered
   * @param {string} entityType - Type of entity
   * @returns {boolean} True if factory exists
   */
  has(entityType) {
    return this.factories.has(entityType);
  }

  /**
   * List all available entity types
   * @returns {Array<string>} Array of entity types
   */
  listAvailable() {
    return Array.from(this.factories.keys());
  }

  /**
   * Get all factories
   * @returns {Map} Map of all factories
   */
  getAll() {
    return this.factories;
  }

  /**
   * Unregister a factory
   * @param {string} entityType - Type of entity
   * @returns {boolean} True if factory was removed
   */
  unregister(entityType) {
    const removed = this.factories.delete(entityType);
    if (removed) {
      logger.debug(`Unregistered factory for: ${entityType}`);
    }
    return removed;
  }

  /**
   * Clear all registered factories
   */
  clear() {
    this.factories.clear();
    logger.debug('Cleared all registered factories');
  }

  /**
   * Get count of registered factories
   * @returns {number} Number of registered factories
   */
  count() {
    return this.factories.size;
  }

  /**
   * Create entity using registered factory
   * @param {string} entityType - Type of entity
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated entity
   */
  create(entityType, overrides = {}) {
    const factory = this.get(entityType);
    return factory.create(overrides);
  }

  /**
   * Create multiple entities using registered factory
   * @param {string} entityType - Type of entity
   * @param {number} count - Number of entities to create
   * @param {Object} overrides - Optional field overrides
   * @returns {Array} Array of generated entities
   */
  createBatch(entityType, count, overrides = {}) {
    const factory = this.get(entityType);
    return factory.createBatch(count, overrides);
  }

  /**
   * Validate entity using registered factory
   * @param {string} entityType - Type of entity
   * @param {Object} data - Entity data to validate
   * @returns {Object} Validation result
   */
  validate(entityType, data) {
    const factory = this.get(entityType);
    return factory.validate(data);
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance of FactoryRegistry
 * @returns {FactoryRegistry} Singleton instance
 */
function getInstance() {
  if (!instance) {
    instance = new FactoryRegistry();
  }
  return instance;
}

/**
 * Reset singleton instance (useful for testing)
 */
function resetInstance() {
  instance = null;
}

export { FactoryRegistry, getInstance, resetInstance };
export default FactoryRegistry;
