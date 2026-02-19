/**
 * EntityFactory - Base abstract class for all entity factories
 * 
 * Provides common interface and validation logic for creating test entities
 */

import { faker } from '@faker-js/faker';
import DataValidator from '../validation/DataValidator.js';
import logger from '../utils/logger.js';

class EntityFactory {
  constructor(entityType, validationRules = {}) {
    if (new.target === EntityFactory) {
      throw new Error('EntityFactory is abstract and cannot be instantiated directly');
    }

    this.entityType = entityType;
    this.validator = new DataValidator({ [entityType]: validationRules });
    this.faker = faker;
  }

  /**
   * Create a single entity
   * Must be implemented by subclasses
   * @param {Object} overrides - Optional field overrides
   * @returns {Object} Generated entity
   */
  create(overrides = {}) {
    throw new Error('create() must be implemented by subclass');
  }

  /**
   * Create multiple entities
   * @param {number} count - Number of entities to create
   * @param {Object} overrides - Optional field overrides applied to all
   * @returns {Array} Array of generated entities
   */
  createBatch(count, overrides = {}) {
    const entities = [];
    for (let i = 0; i < count; i++) {
      try {
        const entity = this.create(overrides);
        entities.push(entity);
      } catch (error) {
        logger.error(`Failed to create ${this.entityType} #${i + 1}:`, error.message);
        throw error;
      }
    }
    return entities;
  }

  /**
   * Validate entity data
   * @param {Object} data - Entity data to validate
   * @returns {Object} { valid: boolean, errors: Array }
   */
  validate(data) {
    return this.validator.validate(this.entityType, data);
  }

  /**
   * Validate a batch of entities
   * @param {Array} dataArray - Array of entity data
   * @returns {Object} Validation results
   */
  validateBatch(dataArray) {
    return this.validator.validateBatch(this.entityType, dataArray);
  }

  /**
   * Add isSeedData marker to entity
   * @protected
   * @param {Object} entity - Entity to mark
   * @returns {Object} Marked entity
   */
  _markAsSeedData(entity) {
    return {
      ...entity,
      isSeedData: true,
      seedDataGeneratedAt: new Date().toISOString()
    };
  }

  /**
   * Generate a random date between two dates
   * @protected
   * @param {Date} start - Start date
   * @param {Date} end - End date
   * @returns {Date} Random date
   */
  _randomDateBetween(start, end) {
    return this.faker.date.between({ from: start, to: end });
  }

  /**
   * Generate a random date in the past
   * @protected
   * @param {number} years - Number of years in the past
   * @returns {Date} Random past date
   */
  _randomPastDate(years = 1) {
    return this.faker.date.past({ years });
  }

  /**
   * Generate a random date in the future
   * @protected
   * @param {number} years - Number of years in the future
   * @returns {Date} Random future date
   */
  _randomFutureDate(years = 1) {
    return this.faker.date.future({ years });
  }

  /**
   * Pick random item from array
   * @protected
   * @param {Array} array - Array to pick from
   * @returns {*} Random item
   */
  _randomPick(array) {
    return this.faker.helpers.arrayElement(array);
  }

  /**
   * Pick multiple random items from array
   * @protected
   * @param {Array} array - Array to pick from
   * @param {number} count - Number of items to pick
   * @returns {Array} Random items
   */
  _randomPickMultiple(array, count) {
    return this.faker.helpers.arrayElements(array, count);
  }

  /**
   * Generate random number between min and max
   * @protected
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @param {number} decimals - Decimal places (default: 0)
   * @returns {number} Random number
   */
  _randomNumber(min, max, decimals = 0) {
    const multipleOf = decimals > 0 ? Math.pow(10, -decimals) : 1;
    return this.faker.number.float({ min, max, multipleOf });
  }

  /**
   * Generate random integer between min and max
   * @protected
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} Random integer
   */
  _randomInt(min, max) {
    return this.faker.number.int({ min, max });
  }

  /**
   * Generate random boolean with optional weight
   * @protected
   * @param {number} trueWeight - Weight for true (0-1, default: 0.5)
   * @returns {boolean} Random boolean
   */
  _randomBoolean(trueWeight = 0.5) {
    return Math.random() < trueWeight;
  }

  /**
   * Generate unique identifier
   * @protected
   * @returns {string} UUID
   */
  _generateId() {
    return this.faker.string.uuid();
  }

  /**
   * Merge overrides with defaults
   * @protected
   * @param {Object} defaults - Default values
   * @param {Object} overrides - Override values
   * @returns {Object} Merged object
   */
  _mergeOverrides(defaults, overrides) {
    return { ...defaults, ...overrides };
  }

  /**
   * Get entity type
   * @returns {string} Entity type
   */
  getEntityType() {
    return this.entityType;
  }
}

export default EntityFactory;
