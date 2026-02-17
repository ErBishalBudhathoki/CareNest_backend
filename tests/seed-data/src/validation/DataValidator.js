/**
 * DataValidator - Validates entity data against rules and backend API
 * 
 * Validates:
 * - Required fields
 * - Field formats (email, phone, date, etc.)
 * - Value ranges
 * - Business logic rules
 * - Backend API compliance
 */

import logger from '../utils/logger.js';

class DataValidator {
  constructor(validationRules = {}) {
    this.validationRules = validationRules;
    this.errors = [];
  }

  /**
   * Validate a single entity
   * @param {string} entityType - Type of entity (e.g., 'user', 'client')
   * @param {Object} data - Entity data to validate
   * @param {Object} options - Validation options
   * @returns {Object} { valid: boolean, errors: Array }
   */
  validate(entityType, data, options = {}) {
    this.errors = [];

    if (!entityType) {
      this.errors.push({ field: 'entityType', message: 'Entity type is required' });
      return { valid: false, errors: this.errors };
    }

    if (!data || typeof data !== 'object') {
      this.errors.push({ field: 'data', message: 'Data must be a valid object' });
      return { valid: false, errors: this.errors };
    }

    const rules = this.validationRules[entityType];
    if (!rules) {
      logger.warn(`No validation rules found for entity type: ${entityType}`);
      return { valid: true, errors: [] };
    }

    // Validate required fields
    this._validateRequiredFields(rules, data);

    // Validate field formats
    this._validateFieldFormats(rules, data);

    // Validate value ranges
    this._validateValueRanges(rules, data);

    // Validate custom business logic
    if (rules.customValidators) {
      this._validateCustomRules(rules.customValidators, data);
    }

    const valid = this.errors.length === 0;
    return { valid, errors: this.errors };
  }

  /**
   * Validate a batch of entities
   * @param {string} entityType - Type of entities
   * @param {Array} dataArray - Array of entity data
   * @param {Object} options - Validation options
   * @returns {Object} { valid: boolean, results: Array, summary: Object }
   */
  validateBatch(entityType, dataArray, options = {}) {
    if (!Array.isArray(dataArray)) {
      return {
        valid: false,
        results: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: ['Data must be an array'] }
      };
    }

    const results = [];
    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const result = this.validate(entityType, dataArray[i], options);
      results.push({
        index: i,
        ...result
      });

      if (result.valid) {
        validCount++;
      } else {
        invalidCount++;
      }
    }

    return {
      valid: invalidCount === 0,
      results,
      summary: {
        total: dataArray.length,
        valid: validCount,
        invalid: invalidCount
      }
    };
  }

  /**
   * Validate entity against backend API
   * @param {string} entityType - Type of entity
   * @param {Object} data - Entity data
   * @param {Object} apiClient - API client instance
   * @returns {Promise<Object>} { valid: boolean, errors: Array, response: Object }
   */
  async validateAgainstAPI(entityType, data, apiClient) {
    try {
      // First validate locally
      const localValidation = this.validate(entityType, data);
      if (!localValidation.valid) {
        return {
          valid: false,
          errors: localValidation.errors,
          response: null
        };
      }

      // Then validate against API (dry-run)
      const endpoint = this._getValidationEndpoint(entityType);
      if (!endpoint) {
        logger.warn(`No validation endpoint configured for: ${entityType}`);
        return { valid: true, errors: [], response: null };
      }

      const response = await apiClient.post(endpoint, {
        ...data,
        dryRun: true // Don't actually create, just validate
      });

      return {
        valid: response.status === 200,
        errors: response.data?.errors || [],
        response: response.data
      };
    } catch (error) {
      logger.error(`API validation failed for ${entityType}:`, error.message);
      return {
        valid: false,
        errors: [{ field: 'api', message: error.message }],
        response: null
      };
    }
  }

  /**
   * Validate required fields
   * @private
   */
  _validateRequiredFields(rules, data) {
    if (!rules.required || !Array.isArray(rules.required)) {
      return;
    }

    for (const field of rules.required) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        this.errors.push({
          field,
          message: `Required field '${field}' is missing or empty`,
          type: 'required'
        });
      }
    }
  }

  /**
   * Validate field formats
   * @private
   */
  _validateFieldFormats(rules, data) {
    if (!rules.formats) {
      return;
    }

    for (const [field, format] of Object.entries(rules.formats)) {
      const value = data[field];
      
      // Skip if field is not present (required validation handles this)
      if (value === undefined || value === null) {
        continue;
      }

      let isValid = true;
      let errorMessage = '';

      switch (format) {
        case 'email':
          isValid = this._validateEmail(value);
          errorMessage = 'Invalid email format';
          break;
        case 'phone':
          isValid = this._validatePhone(value);
          errorMessage = 'Invalid phone format';
          break;
        case 'date':
          isValid = this._validateDate(value);
          errorMessage = 'Invalid date format';
          break;
        case 'url':
          isValid = this._validateURL(value);
          errorMessage = 'Invalid URL format';
          break;
        case 'numeric':
          isValid = this._validateNumeric(value);
          errorMessage = 'Must be a number';
          break;
        case 'boolean':
          isValid = typeof value === 'boolean';
          errorMessage = 'Must be a boolean';
          break;
        default:
          logger.warn(`Unknown format type: ${format}`);
      }

      if (!isValid) {
        this.errors.push({
          field,
          message: errorMessage,
          type: 'format',
          format
        });
      }
    }
  }

  /**
   * Validate value ranges
   * @private
   */
  _validateValueRanges(rules, data) {
    if (!rules.ranges) {
      return;
    }

    for (const [field, range] of Object.entries(rules.ranges)) {
      const value = data[field];
      
      // Skip if field is not present
      if (value === undefined || value === null) {
        continue;
      }

      // Min value check
      if (range.min !== undefined && value < range.min) {
        this.errors.push({
          field,
          message: `Value must be at least ${range.min}`,
          type: 'range',
          constraint: 'min'
        });
      }

      // Max value check
      if (range.max !== undefined && value > range.max) {
        this.errors.push({
          field,
          message: `Value must be at most ${range.max}`,
          type: 'range',
          constraint: 'max'
        });
      }

      // Min length check (for strings/arrays)
      if (range.minLength !== undefined) {
        const length = typeof value === 'string' ? value.length : value?.length;
        if (length < range.minLength) {
          this.errors.push({
            field,
            message: `Length must be at least ${range.minLength}`,
            type: 'range',
            constraint: 'minLength'
          });
        }
      }

      // Max length check (for strings/arrays)
      if (range.maxLength !== undefined) {
        const length = typeof value === 'string' ? value.length : value?.length;
        if (length > range.maxLength) {
          this.errors.push({
            field,
            message: `Length must be at most ${range.maxLength}`,
            type: 'range',
            constraint: 'maxLength'
          });
        }
      }

      // Enum check
      if (range.enum && Array.isArray(range.enum)) {
        if (!range.enum.includes(value)) {
          this.errors.push({
            field,
            message: `Value must be one of: ${range.enum.join(', ')}`,
            type: 'range',
            constraint: 'enum'
          });
        }
      }
    }
  }

  /**
   * Validate custom business logic rules
   * @private
   */
  _validateCustomRules(validators, data) {
    for (const validator of validators) {
      try {
        const result = validator(data);
        if (result && !result.valid) {
          this.errors.push({
            field: result.field || 'custom',
            message: result.message || 'Custom validation failed',
            type: 'custom'
          });
        }
      } catch (error) {
        logger.error('Custom validator error:', error.message);
        this.errors.push({
          field: 'custom',
          message: `Validation error: ${error.message}`,
          type: 'custom'
        });
      }
    }
  }

  /**
   * Format validators
   * @private
   */
  _validateEmail(value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }

  _validatePhone(value) {
    if (typeof value !== 'string') return false;
    const digits = value.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  _validateDate(value) {
    if (value instanceof Date) {
      return !isNaN(value.getTime());
    }
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  _validateURL(value) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  _validateNumeric(value) {
    return typeof value === 'number' && !isNaN(value);
  }

  /**
   * Get validation endpoint for entity type
   * @private
   */
  _getValidationEndpoint(entityType) {
    const endpoints = {
      user: '/api/users/validate',
      client: '/api/clients/validate',
      worker: '/api/workers/validate',
      shift: '/api/shifts/validate',
      invoice: '/api/invoices/validate',
      carePlan: '/api/care-plans/validate',
      timesheet: '/api/timesheets/validate',
      expense: '/api/expenses/validate',
      complianceRecord: '/api/compliance/validate'
    };
    return endpoints[entityType];
  }

  /**
   * Add validation rule for entity type
   * @param {string} entityType - Entity type
   * @param {Object} rules - Validation rules
   */
  addValidationRule(entityType, rules) {
    this.validationRules[entityType] = rules;
  }

  /**
   * Get validation rules for entity type
   * @param {string} entityType - Entity type
   * @returns {Object} Validation rules
   */
  getValidationRules(entityType) {
    return this.validationRules[entityType] || null;
  }
}

export default DataValidator;
