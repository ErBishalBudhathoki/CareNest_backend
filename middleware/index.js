/**
 * Middleware exports
 * Centralizes all middleware imports for easy access
 */

const { corsMiddleware, customCorsHeaders } = require('./cors');
const { loggingMiddleware, silentLoggingMiddleware } = require('./logging');
const {
  authenticateUser,
  verifyOrganizationAccess,
  verifyAdminAccess,
  verifyOTPMiddleware,
  validateRequiredFields,
  rateLimit
} = require('./auth');

const { organizationContextMiddleware } = require('./organizationContext');

const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  createValidationError,
  createDatabaseError,
  createAuthError,
  createAuthorizationError,
  createNotFoundError,
  createConflictError,
  createRateLimitError
} = require('./errorHandler');

module.exports = {
  // CORS middleware
  corsMiddleware,
  customCorsHeaders,
  
  // Logging middleware
  loggingMiddleware,
  silentLoggingMiddleware,
  
  // Authentication middleware
  authenticateUser,
  verifyOrganizationAccess,
  verifyAdminAccess,
  verifyOTPMiddleware,
  validateRequiredFields,
  rateLimit,
  organizationContextMiddleware,
  
  // Error handling middleware
  errorHandler,
  notFoundHandler,
  asyncHandler,
  
  // Error classes and helpers
  AppError,
  createValidationError,
  createDatabaseError,
  createAuthError,
  createAuthorizationError,
  createNotFoundError,
  createConflictError,
  createRateLimitError
};
