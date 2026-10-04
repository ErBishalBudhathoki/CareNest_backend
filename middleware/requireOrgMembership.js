/**
 * requireOrgMembership
 *
 * Thin wrapper around organizationContextMiddleware that first rejects
 * contradictory tenant hints, so a client cannot send one organization in the
 * header and a different one in the query/body/params and have us silently
 * pick one. Membership validation itself lives in organizationContext
 * (UserOrganization active-membership check) and is unchanged.
 */
const { organizationContextMiddleware } = require('./organizationContext');
const SecureErrorHandler = require('../utils/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('RequireOrgMembership');

function requireOrgMembership(req, res, next) {
  const headerOrg = req.headers['x-organization-id'];
  const alternates = [
    req.query && req.query.organizationId,
    req.body && req.body.organizationId,
    req.params && req.params.organizationId,
  ].filter(Boolean);

  if (headerOrg && alternates.some((alt) => alt !== headerOrg)) {
    logger.security('Contradictory organization identifiers in request', {
      userId: req.user ? req.user.userId : 'unknown',
      path: req.originalUrl || req.path,
      ip: req.ip,
    });
    return res.status(400).json(
      SecureErrorHandler.createErrorResponse(
        'organizationId in header does not match request body/query/params',
        400,
        'ORG_ID_CONFLICT'
      )
    );
  }

  return organizationContextMiddleware(req, res, next);
}

module.exports = { requireOrgMembership };
