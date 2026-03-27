function normalizePath(path = '') {
  return String(path).split('?')[0];
}

function matchesPathPrefix(path, prefix) {
  const normalizedPath = normalizePath(path);
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

const PUBLIC_AUTH_ENDPOINT_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/register-fcm-token',
  '/api/auth/secure-login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/verify-organization',
  '/api/auth/resend-verification',
  '/api/auth/security-log',
  '/api/auth/health',
  '/api/auth/v2/register',
  '/api/auth/v2/login',
  '/api/auth/v2/refresh-token',
  '/api/auth/v2/logout',
];

const AUTH_PUBLIC_ENDPOINT_PREFIXES = [
  ...PUBLIC_AUTH_ENDPOINT_PREFIXES,
  '/api/firebase-auth',
  '/api/health',
  '/api-docs',
  '/api-docs.json',
];

const API_SECURITY_BYPASS_PREFIXES = [
  ...PUBLIC_AUTH_ENDPOINT_PREFIXES,
  '/api/firebase-auth',
  '/api/health',
  // Uses Cloud Scheduler OIDC auth and should not be forced through
  // the mobile app App Check + bearer token gate.
  '/api/scheduler',
];

function isPublicAuthPath(path) {
  return AUTH_PUBLIC_ENDPOINT_PREFIXES.some((prefix) =>
    matchesPathPrefix(path, prefix)
  );
}

function shouldBypassApiSecurity(path, method) {
  if (String(method || '').toUpperCase() === 'OPTIONS') {
    return true;
  }

  return API_SECURITY_BYPASS_PREFIXES.some((prefix) =>
    matchesPathPrefix(path, prefix)
  );
}

module.exports = {
  isPublicAuthPath,
  shouldBypassApiSecurity,
};
