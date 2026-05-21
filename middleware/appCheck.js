const { admin } = require('../firebase-admin-config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AppCheckMiddleware');

function isAppCheckEnforced() {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  // Explicit flag takes precedence.
  if (process.env.APP_CHECK_ENFORCEMENT === 'true') {
    return true;
  }
  if (process.env.APP_CHECK_ENFORCEMENT === 'false') {
    return false;
  }

  // Secure-by-default in production when the flag is omitted.
  return process.env.NODE_ENV === 'production';
}

function isIOSPlatform(req) {
  const platform = req.header('X-Platform');
  return platform && platform.toLowerCase() === 'ios';
}

async function requireAppCheck(req, res, next) {
  logger.debug('AppCheck incoming headers', {
    url: req.originalUrl,
    method: req.method,
    headers: req.headers
  });

  // Skip App Check for iOS - requires Apple Developer account for App Attest
  if (isIOSPlatform(req)) {
    logger.debug('Skipping App Check for iOS platform', {
      path: req.originalUrl,
      method: req.method
    });
    return next();
  }

  if (!isAppCheckEnforced()) {
    return next();
  }

  const token = req.header('X-Firebase-AppCheck');
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Missing App Check token',
      errorCode: 'MISSING_APP_CHECK_TOKEN'
    });
  }

  // Optional debug bypass for local/dev troubleshooting only.
  if (process.env.APP_CHECK_DEBUG_TOKEN && token === process.env.APP_CHECK_DEBUG_TOKEN) {
    return next();
  }

  try {
    const appCheck = admin.appCheck();
    await appCheck.verifyToken(token);
    return next();
  } catch (error) {
    logger.warn('Invalid App Check token', {
      error: error.message,
      path: req.originalUrl,
      method: req.method
    });
    return res.status(401).json({
      success: false,
      message: 'Invalid App Check token',
      errorCode: 'INVALID_APP_CHECK_TOKEN'
    });
  }
}

module.exports = {
  requireAppCheck,
  isAppCheckEnforced
};
