function _hasAdminRole(req) {
  const roles = req.user && Array.isArray(req.user.roles) ? req.user.roles : [];
  return roles.includes('admin');
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

