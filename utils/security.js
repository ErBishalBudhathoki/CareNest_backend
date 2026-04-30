/**
 * Security Utilities
 * Helpers for preventing NoSQL injection, property injection, and type confusion.
 */

/**
 * Ensures a value is a string. If it's an array or object, it returns the first element
 * or a default value, effectively neutralizing type confusion attacks.
 * 
 * @param {any} val - The value to sanitize
 * @param {string} defaultVal - Default value if sanitization fails
 * @returns {string}
 */
const toSafeString = (val, defaultVal = '') => {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return typeof val[0] === 'string' ? val[0] : defaultVal;
  if (val && typeof val === 'object') return defaultVal;
  return val != null ? String(val) : defaultVal;
};

/**
 * Validates a property key to prevent prototype pollution or unauthorized property access.
 * 
 * @param {string} key - The key to validate
 * @returns {boolean}
 */
const isValidKey = (key) => {
  if (typeof key !== 'string') return false;
  const forbidden = ['__proto__', 'constructor', 'prototype'];
  return key && !forbidden.includes(key);
};

/**
 * Sanitizes a query object to prevent NoSQL injection.
 * It removes any keys starting with '$' unless they are in the allowed list.
 * 
 * @param {Object} query - The query object to sanitize
 * @returns {Object}
 */
const sanitizeQuery = (query) => {
  if (!query || typeof query !== 'object') return query;
  
  const sanitized = {};
  for (const [key, value] of Object.entries(query)) {
    // Only allow safe keys (no leading $)
    if (typeof key === 'string' && !key.startsWith('$')) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = sanitizeQuery(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  return sanitized;
};

module.exports = {
  toSafeString,
  isValidKey,
  sanitizeQuery
};
