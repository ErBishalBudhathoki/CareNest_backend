const UserOrganization = require('../models/UserOrganization');

function _hasAdminRole(req) {
  if (!req.user) return false;
  const roles = Array.isArray(req.user.roles)
    ? req.user.roles
        .map((role) => String(role || '').toLowerCase().trim())
        .filter(Boolean)
    : [];
  if (roles.includes('admin') || roles.includes('owner')) return true;
  if (
    typeof req.user.role === 'string' &&
    ['admin', 'owner'].includes(req.user.role.toLowerCase().trim())
  ) {
    return true;
  }
  if (req.user.customClaims && Array.isArray(req.user.customClaims.roles)) {
    const claimRoles = req.user.customClaims.roles
      .map((role) => String(role || '').toLowerCase().trim())
      .filter(Boolean);
    if (claimRoles.includes('admin') || claimRoles.includes('owner'))
      return true;
  }
  return false;
}

async function _hasOrganizationAdminRole(req) {
  const userId = req?.user?.userId || req?.user?.id;
  if (!userId) return false;

  const orgIdCandidates = [
    req?.params?.organizationId,
    req?.body?.organizationId,
    req?.query?.organizationId,
    req?.user?.lastActiveOrganizationId,
    req?.user?.organizationId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const query = {
    userId: String(userId),
    isActive: true,
    role: { $in: ['owner', 'admin'] },
  };

  if (orgIdCandidates.length > 0) {
    query.organizationId = { $in: [...new Set(orgIdCandidates)] };
  }

  const membership = await UserOrganization.findOne(query).select('_id').lean();
  return Boolean(membership);
}

function requireAdmin(req, res, next) {
  (async () => {
    if (_hasAdminRole(req) || (await _hasOrganizationAdminRole(req))) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  })().catch(next);
}

function requireSelfOrAdmin(paramName = 'userEmail') {
  return function (req, res, next) {
    (async () => {
      if (_hasAdminRole(req) || (await _hasOrganizationAdminRole(req))) {
        return next();
      }
      const requested = req.params ? req.params[paramName] : undefined;
      if (
        requested &&
        req.user &&
        req.user.email &&
        requested === req.user.email
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    })().catch(next);
  };
}

function requireOrganizationMatch(paramName = 'organizationId') {
  return function (req, res, next) {
    const requested = req.params ? req.params[paramName] : undefined;
    const userOrg = req.user ? req.user.organizationId : undefined;
    if (_hasAdminRole(req) && requested && userOrg && String(requested) === String(userOrg)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'Unauthorized',
    });
  };
}

module.exports = {
  requireAdmin,
  requireSelfOrAdmin,
  requireOrganizationMatch,
};
