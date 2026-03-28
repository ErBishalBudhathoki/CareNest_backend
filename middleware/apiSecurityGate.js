const { authenticateUser } = require('./auth');
const { requireAppCheck } = require('./appCheck');
const { shouldBypassApiSecurity } = require('./apiAccessPolicy');

function apiSecurityGate(req, res, next) {
  const requestPath = req.originalUrl || req.path;

  if (shouldBypassApiSecurity(requestPath, req.method)) {
    return next();
  }

  // Protected /api routes expect a client App Check token before bearer auth.
  // Any future server-to-server caller should use a deliberately designed
  // bypass or gateway path instead of weakening this default gate.
  return requireAppCheck(req, res, (appCheckError) => {
    if (appCheckError) {
      return next(appCheckError);
    }

    return authenticateUser(req, res, next);
  });
}

module.exports = {
  apiSecurityGate,
};
