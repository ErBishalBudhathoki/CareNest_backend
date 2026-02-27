function _hasAdminRole(req) {
  if (!req.user) return false;
  const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
  if (roles.includes('admin')) return true;
  if (typeof req.user.role === 'string' && req.user.role === 'admin') {
    return true;
  }
  if (req.user.customClaims && Array.isArray(req.user.customClaims.roles)) {
    if (req.user.customClaims.roles.includes('admin')) return true;
  }
  return false;
}

function requireAdmin(req, res, next) {
  if (_hasAdminRole(req)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Admin access required',
  });
}

function requireSelfOrAdmin(paramName = 'userEmail') {
  return function (req, res, next) {
    if (_hasAdminRole(req)) {
      return next();
    }
    const requested = req.params ? req.params[paramName] : undefined;
    if (requested && req.user && req.user.email && requested === req.user.email) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'Unauthorized',
    });
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
