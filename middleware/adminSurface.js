/**
 * Server-side gate for the admin-only financial surfaces behind
 * "Invoice Operations" and "Configuration & Finance".
 *
 * The mobile app's cached UserRole is a UI hint, not an authorization
 * boundary: the Admin -> Employee mode switch only changes local state and
 * navigation arguments, it never reissues the Firebase/JWT credential. These
 * middlewares therefore read only server-verified identity and membership.
 */
const SecureErrorHandler = require('../utils/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AdminSurface');

// Keep in sync with UserRoleResolver._adminRoleTags in
// lib/app/features/auth/models/user_role.dart. Owner/manager tokens must not
// be locked out of the surfaces the app already renders for them.
const ADMIN_ROLE_TAGS = [
  'admin',
  'owner',
  'manager',
  'superadmin',
  'moderator',
];

function normalize(value) {
  return String(value == null ? '' : value).toLowerCase().trim();
}

function tokenRoles(req) {
  const values = [];
  if (Array.isArray(req.user && req.user.roles)) values.push(...req.user.roles);
  if (req.user && req.user.role) values.push(req.user.role);
  if (req.user && req.user.customClaims && Array.isArray(req.user.customClaims.roles)) {
    values.push(...req.user.customClaims.roles);
  }
  return values.map(normalize).filter(Boolean);
}

function deny(req, res, reason) {
  logger.security('Admin surface denied', {
    reason,
    userId: req.user ? req.user.userId : 'unknown',
    path: req.originalUrl || req.path,
    ip: req.ip,
  });
  return res.status(403).json(
    SecureErrorHandler.createErrorResponse(
      SecureErrorHandler.GENERIC_FORBIDDEN_ERROR,
      403,
      'INSUFFICIENT_PERMISSIONS'
    )
  );
}

/**
 * Reject non-admin tokens. When an organisation membership context has been
 * resolved, also require an admin-equivalent role *in that organisation*.
 * That second check closes the dual-membership escalation where an admin of
 * org A is only an employee of org B and names org B in the request body.
 */
function requireAdminSurface(req, res, next) {
  if (!req.user) return deny(req, res, 'unauthenticated');
  if (!tokenRoles(req).some((role) => ADMIN_ROLE_TAGS.includes(role))) {
    return deny(req, res, 'token role is not admin-equivalent');
  }

  const context = req.organizationContext;
  if (context && !ADMIN_ROLE_TAGS.includes(normalize(context.userRole))) {
    return deny(req, res, 'membership role in the target organisation is not admin-equivalent');
  }

  return next();
}

/**
 * Reject a request that names a different organisation than the validated
 * membership context. This closes the header/param split: organisationContext
 * resolves `x-organization-id` FIRST, while several controllers write to
 * `req.params.organizationId` — without this check a caller could validate
 * membership in org A and mutate org B.
 *
 * With `pinBody`, also pin req.body.organizationId to the validated id, for
 * controllers that historically read the organisation straight from the body.
 * Routers whose body IS the update payload must pass `false`: pinning would
 * inject an `organizationId` field into `$set: req.body`.
 */
function organizationMatchMiddleware({ pinBody }) {
  return function requireMatchingOrganizationImpl(req, res, next) {
    const resolved = req.organizationContext && req.organizationContext.organizationId;
    if (!resolved) return next();

    const supplied = [
      req.headers && req.headers['x-organization-id'],
      req.query && req.query.organizationId,
      req.body && req.body.organizationId,
      req.params && req.params.organizationId,
    ]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map(String);

    const expected = String(resolved);
    if (supplied.some((value) => value !== expected)) {
      logger.security('Request organisation does not match validated membership', {
        userId: req.user ? req.user.userId : 'unknown',
        path: req.originalUrl || req.path,
        ip: req.ip,
      });
      return res.status(403).json(
        SecureErrorHandler.createErrorResponse(
          'Requested organisation does not match the active organisation',
          403,
          'ORGANIZATION_MISMATCH'
        )
      );
    }

    if (pinBody && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      req.body.organizationId = expected;
    }
    return next();
  };
}

const requireMatchingOrganization = organizationMatchMiddleware({ pinBody: true });

// For `PUT /organization/:organizationId` and `/branding`: the request body is
// the raw update document, so it must be left exactly as the client sent it.
const requireMatchingOrganizationNoBodyPin = organizationMatchMiddleware({ pinBody: false });

module.exports = {
  ADMIN_ROLE_TAGS,
  requireAdminSurface,
  requireMatchingOrganization,
  requireMatchingOrganizationNoBodyPin,
};
