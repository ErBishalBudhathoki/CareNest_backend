/**
 * HTTPS Enforcement Middleware
 *
 * Rejects plaintext HTTP traffic in production so API data (NDIS/PII) is
 * always encrypted in transit. Safe to deploy behind Cloud Run / Render /
 * any TLS-terminating proxy:
 *
 * - `trust proxy` is enabled in app.js, so `req.secure` reflects the
 *   `X-Forwarded-Proto` header set by the platform edge.
 * - Platform health probes hit the container directly over plain HTTP, so
 *   `/health` and `/api/health` are exempt (they carry no sensitive data).
 * - In non-production environments the middleware is a no-op, keeping local
 *   `http://localhost` development working.
 *
 * @file backend/middleware/requireHttps.js
 */

// Endpoints the hosting platform probes over plain HTTP inside the
// container network. Exempt so startup/liveness checks never fail.
const PLAINTEXT_ALLOWED_PATHS = new Set(['/health', '/api/health']);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function requireHttps(req, res, next) {
  if (!isProduction()) {
    return next();
  }

  if (req.path && PLAINTEXT_ALLOWED_PATHS.has(req.path)) {
    return next();
  }

  // With `trust proxy` enabled, req.secure is true when the original
  // client request used HTTPS (via X-Forwarded-Proto).
  if (req.secure) {
    return next();
  }

  return res.status(426).json({
    success: false,
    message: 'HTTPS is required to access this API.',
  });
}

module.exports = { requireHttps, PLAINTEXT_ALLOWED_PATHS };
