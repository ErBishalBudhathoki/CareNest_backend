const UserOrganization = require('../models/UserOrganization');
const SecureErrorHandler = require('../utils/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('OrganizationContextMiddleware');

/**
 * Organization Context Middleware
 * Validates organization access and sets the organization context for the request
 */
const organizationContextMiddleware = async (req, res, next) => {
  try {
    // 1. Get Organization ID from header or user's last active org
    const orgId = req.headers['x-organization-id'] || (req.user && req.user.lastActiveOrganizationId);

    if (!orgId) {
      // If no organization context is required for this route, skip
      // But usually, if this middleware is used, context is expected.
      // We can make it optional by checking a flag or path, but for now let's assume strict mode
      // unless it's explicitly an optional route.
      // For now, let's just log and proceed if not critical, or return error?
      // Better to return 400 if org context is missing but required.
      // However, for initial login/dashboard, it might not be known.
      // Let's check if req.user exists. If not, we can't do much.
      if (!req.user) {
        return next();
      }
      
      // If user has no context, maybe they are new?
      return next(); 
    }

    // 2. Validate user has access to organization
    const userOrg = await UserOrganization.findOne({
      userId: req.user.userId, // req.user.userId from auth middleware
      organizationId: orgId,
      isActive: true
    });

    if (!userOrg) {
      logger.security('Access denied to organization', {
        userId: req.user.userId,
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

    // 3. Set Context
    req.organizationContext = {
      organizationId: orgId,
      userRole: userOrg.role,
      permissions: userOrg.permissions
    };
    
    // Also update request.organizationId for convenience if needed by legacy code
    // But prefer req.organizationContext.organizationId
    
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

module.exports = { organizationContextMiddleware };
