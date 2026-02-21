const UserOrganization = require('../models/UserOrganization');
const SecureErrorHandler = require('../utils/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('OrganizationContextMiddleware');

/**
 * Organization Context Middleware
 * Validates organization access and sets the organization context for the request
 * 
 * ZERO-TRUST SECURITY:
 * - Requires explicit organization context for all protected routes
 * - Validates user has active membership in the organization
 * - Sets organizationContext on request for controllers to use
 */
const organizationContextMiddleware = async (req, res, next) => {
  try {
    // Public endpoints that don't require organization context
    const publicEndpoints = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/secure-login',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/verify-email',
      '/api/auth/health',
      '/api/auth/v2/register',
      '/api/auth/v2/login',
      '/api/health',
      '/api-docs',
      '/api-docs.json',
      '/api/firebase-auth'
    ];

    const path = req.originalUrl || req.path;
    if (publicEndpoints.some(endpoint => path.startsWith(endpoint))) {
      return next();
    }

    // Require authenticated user
    if (!req.user || !req.user.userId) {
      logger.security('Organization context middleware called without authenticated user', {
        ip: req.ip,
        path: path
      });
      return res.status(401).json(
        SecureErrorHandler.createErrorResponse(
          'Authentication required',
          401,
          'AUTH_REQUIRED'
        )
      );
    }

    // 1. Get Organization ID from multiple sources (in priority order)
    const orgId =
      req.headers['x-organization-id'] ||  // Explicit header (preferred)
      req.query.organizationId ||           // Query parameter
      req.body.organizationId ||            // Body parameter
      req.params.organizationId ||          // URL parameter
      req.user.lastActiveOrganizationId ||  // User's last active org (fallback)
      req.user.organizationId;              // User's primary org (last fallback)

    if (!orgId) {
      logger.security('No organization context provided', {
        userId: req.user.userId,
        email: req.user.email,
        ip: req.ip,
        path: req.path,
        method: req.method
      });
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Organization context required. Provide x-organization-id header or organizationId parameter.',
          400,
          'ORG_CONTEXT_REQUIRED'
        )
      );
    }

    // 2. Validate user has access to organization
    const userOrg = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: orgId,
      isActive: true
    });

    if (!userOrg) {
      logger.security('Access denied to organization', {
        userId: req.user.userId,
        email: req.user.email,
        organizationId: orgId,
        ip: req.ip,
        path: req.path
      });
      return res.status(403).json(
        SecureErrorHandler.createErrorResponse(
          'Access denied to organization',
          403,
          'ORG_ACCESS_DENIED'
        )
      );
    }

    // 3. Set Context with full details
    req.organizationContext = {
      organizationId: orgId,
      userRole: userOrg.role,
      permissions: userOrg.permissions || [],
      isOwner: userOrg.role === 'owner',
      isAdmin: userOrg.role === 'admin' || userOrg.role === 'owner'
    };

    logger.debug('Organization context set', {
      userId: req.user.userId,
      organizationId: orgId,
      role: userOrg.role
    });

    next();
  } catch (error) {
    logger.error('Organization context error', {
      error: error.message,
      stack: error.stack,
      userId: req.user ? req.user.userId : 'unknown'
    });
    return res.status(500).json(
      SecureErrorHandler.createErrorResponse(
        'Internal server error processing organization context',
        500,
        'ORG_CONTEXT_ERROR'
      )
    );
  }
};

/**
 * Optional Organization Context Middleware
 * Same as organizationContextMiddleware but does not fail if no org context is provided
 * Use this for endpoints that can work with or without organization context
 */
const optionalOrganizationContext = async (req, res, next) => {
  try {
    if (!req.user || !req.user.userId) {
      return next(); // No user, skip organization context
    }

    const orgId =
      req.headers['x-organization-id'] ||
      req.query.organizationId ||
      req.body.organizationId ||
      req.params.organizationId ||
      req.user.lastActiveOrganizationId;

    if (!orgId) {
      return next(); // No org context, continue without it
    }

    // Validate access
    const userOrg = await UserOrganization.findOne({
      userId: req.user.userId,
      organizationId: orgId,
      isActive: true
    });

    if (userOrg) {
      req.organizationContext = {
        organizationId: orgId,
        userRole: userOrg.role,
        permissions: userOrg.permissions || [],
        isOwner: userOrg.role === 'owner',
        isAdmin: userOrg.role === 'admin' || userOrg.role === 'owner'
      };
    }

    next();
  } catch (error) {
    logger.error('Optional organization context error', {
      error: error.message,
      userId: req.user ? req.user.userId : 'unknown'
    });
    next(); // Continue even if error
  }
};

/**
 * Middleware factory to validate resource belongs to organization
 * Use this AFTER organizationContextMiddleware to ensure resource ownership
 * 
 * @param {string} resourceIdField - Field name containing resource ID (e.g., 'invoiceId', 'clientId')
 * @param {Function} modelGetter - Function that returns the Mongoose model
 * @param {string} orgFieldName - Field name in model containing organizationId (default: 'organizationId')
 * 
 * @example
 * router.get('/invoices/:invoiceId',
 *   authenticateUser,
 *   organizationContextMiddleware,
 *   requireOrganizationOwnership('invoiceId', () => Invoice),
 *   getInvoice
 * );
 */
function requireOrganizationOwnership(resourceIdField, modelGetter, orgFieldName = 'organizationId') {
  return async (req, res, next) => {
    try {
      // Get resource ID from params, query, or body
      const resourceId = req.params[resourceIdField] ||
        req.query[resourceIdField] ||
        req.body[resourceIdField];

      if (!resourceId) {
        return res.status(400).json(
          SecureErrorHandler.createErrorResponse(
            `${resourceIdField} is required`,
            400,
            'RESOURCE_ID_REQUIRED'
          )
        );
      }

      if (!req.organizationContext || !req.organizationContext.organizationId) {
        return res.status(400).json(
          SecureErrorHandler.createErrorResponse(
            'Organization context required',
            400,
            'ORG_CONTEXT_REQUIRED'
          )
        );
      }

      // Fetch resource
      const Model = modelGetter();
      const resource = await Model.findById(resourceId).select(orgFieldName);

      if (!resource) {
        return res.status(404).json(
          SecureErrorHandler.createErrorResponse(
            'Resource not found',
            404,
            'RESOURCE_NOT_FOUND'
          )
        );
      }

      // Validate organization ownership
      if (resource[orgFieldName].toString() !== req.organizationContext.organizationId) {
        logger.security('Organization ownership violation attempt', {
          userId: req.user.userId,
          resourceId,
          resourceOrganizationId: resource[orgFieldName],
          userOrganizationId: req.organizationContext.organizationId,
          ip: req.ip,
          path: req.path
        });

        return res.status(403).json(
          SecureErrorHandler.createErrorResponse(
            'Access denied to this resource',
            403,
            'ORG_OWNERSHIP_DENIED'
          )
        );
      }

      // Store resource on request for controller use (optional)
      req.resource = resource;
      next();
    } catch (error) {
      logger.error('Organization ownership validation error', {
        error: error.message,
        resourceIdField,
        userId: req.user ? req.user.userId : 'unknown'
      });
      return res.status(500).json(
        SecureErrorHandler.createErrorResponse(
          'Error validating resource ownership',
          500,
          'OWNERSHIP_CHECK_ERROR'
        )
      );
    }
  };
}

/**
 * Helper middleware to ensure organization ID in request body matches context
 * Use this for POST/PUT requests where organizationId is in the body
 */
const requireOrganizationMatch = (bodyFieldName = 'organizationId') => {
  return (req, res, next) => {
    const bodyOrgId = req.body[bodyFieldName];

    if (!bodyOrgId) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          `${bodyFieldName} is required in request body`,
          400,
          'ORG_ID_REQUIRED'
        )
      );
    }

    if (!req.organizationContext || !req.organizationContext.organizationId) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Organization context required',
          400,
          'ORG_CONTEXT_REQUIRED'
        )
      );
    }

    if (bodyOrgId !== req.organizationContext.organizationId) {
      logger.security('Organization ID mismatch attempt', {
        userId: req.user.userId,
        bodyOrganizationId: bodyOrgId,
        contextOrganizationId: req.organizationContext.organizationId,
        ip: req.ip,
        path: req.path
      });

      return res.status(403).json(
        SecureErrorHandler.createErrorResponse(
          'Organization ID mismatch',
          403,
          'ORG_MISMATCH'
        )
      );
    }

    next();
  };
};

/**
 * Helper middleware to ensure organization ID in query string matches context
 * Use this for GET requests where organizationId is in the query
 */
const requireOrganizationQueryMatch = (queryFieldName = 'organizationId') => {
  return (req, res, next) => {
    const queryOrgId = req.query[queryFieldName];

    if (!queryOrgId) {
      // If not in query, nothing to mismatch against.
      // If query param is required, use express-validator or similar.
      return next();
    }

    if (!req.organizationContext || !req.organizationContext.organizationId) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Organization context required',
          400,
          'ORG_CONTEXT_REQUIRED'
        )
      );
    }

    if (queryOrgId !== req.organizationContext.organizationId) {
      logger.security('Organization ID query mismatch attempt', {
        userId: req.user.userId,
        queryOrganizationId: queryOrgId,
        contextOrganizationId: req.organizationContext.organizationId,
        ip: req.ip,
        path: req.path
      });

      return res.status(403).json(
        SecureErrorHandler.createErrorResponse(
          'Organization ID mismatch in query',
          403,
          'ORG_MISMATCH'
        )
      );
    }

    next();
  };
};

module.exports = {
  organizationContextMiddleware,
  optionalOrganizationContext,
  requireOrganizationOwnership,
  requireOrganizationMatch,
  requireOrganizationQueryMatch
};
