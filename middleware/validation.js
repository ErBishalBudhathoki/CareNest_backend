/**
 * Central Validation Middleware
 * Reusable validation utilities and error handlers for all routes
 * 
 * @file backend/middleware/validation.js
 */

const { validationResult, body, param, query } = require('express-validator');

/**
 * Handle validation errors middleware
 * Returns standardized error response for validation failures
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

/**
 * Common validation chains
 */
const validators = {
  // Organization
  organizationId: param('organizationId')
    .notEmpty().withMessage('Organization ID is required')
    .isMongoId().withMessage('Invalid organization ID format'),
    
  bodyOrganizationId: body('organizationId')
    .notEmpty().withMessage('Organization ID is required')
    .isMongoId().withMessage('Invalid organization ID format'),
    
  // User
  userEmail: (location = 'body') => {
    const validator = location === 'param' ? param('userEmail') : 
                     location === 'query' ? query('userEmail') : body('userEmail');
    return validator
      .notEmpty().withMessage('User email is required')
      .isEmail().withMessage('Invalid email format')
      .normalizeEmail();
  },
  
  email: body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
    
  password: body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    
  // MongoDB IDs
  mongoId: (field, location = 'param') => {
    const validator = location === 'body' ? body(field) : param(field);
    return validator
      .notEmpty().withMessage(`${field} is required`)
      .isMongoId().withMessage(`Invalid ${field} format`);
  },
  
  // Common fields
  requiredString: (field, location = 'body') => {
    const validator = location === 'param' ? param(field) : body(field);
    return validator
      .notEmpty().withMessage(`${field} is required`)
      .isString().withMessage(`${field} must be a string`)
      .trim();
  },
  
  requiredNumber: (field, location = 'body') => {
    const validator = location === 'body' ? body(field) : param(field);
    return validator
      .notEmpty().withMessage(`${field} is required`)
      .isNumeric().withMessage(`${field} must be a number`);
  },
  
  date: (field, location = 'body') => {
    const validator = location === 'body' ? body(field) : query(field);
    return validator
      .optional()
      .isISO8601().withMessage(`${field} must be a valid date`);
  },
  
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 }).withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
      .toInt()
  ]
};

/**
 * Validation sanitizers
 */
const sanitizers = {
  trim: (field, location = 'body') => {
    return location === 'body' ? body(field).trim() : param(field).trim();
  },
  
  toLowerCase: (field, location = 'body') => {
    const validator = location === 'body' ? body(field) : param(field);
    return validator.customSanitizer(value => value ? value.toLowerCase() : value);
  }
};

/**
 * Conditional validators
 */
const conditionalValidators = {
  ifFieldExists: (field, validator) => {
    return body(field)
      .optional()
      .custom((value, { req }) => {
        if (value !== undefined && value !== null) {
          // Apply the validator
          return validator.run(req);
        }
        return true;
      });
  }
};

module.exports = {
  handleValidationErrors,
  validators,
  sanitizers,
  conditionalValidators,
  body,
  param,
  query
};
