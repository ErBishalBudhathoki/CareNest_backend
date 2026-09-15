const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

/**
 * Global subscription gate.
 *
 * Enabled only when ENTITLEMENT_GATE=true (safe default: fail-open).
 *
 * Hard paywall: an organisation whose subscription is not active/grace/retry
 * is locked out of the paid feature groups below. Everything else (auth,
 * org/client/business/employee/assignment setup, dashboards, subscription
 * purchase) stays accessible so the org can set up and subscribe.
 *
 * Org resolution order: authenticated user's org, route org context, or an
 * explicit organizationId in body/query. If no org can be resolved the request
 * is allowed (auth/bootstrap/public routes).
 */

// Paid feature route groups. Matched as prefixes against req.originalUrl,
// which always starts with '/api'.
const BLOCKED_PREFIXES = [
  '/api/payments',
  '/api/invoices',
  '/api/invoice', // invoice generation + management + /invoice-ai
  '/api/client-portal/invoices',
  '/api/client-portal/invoice',
  '/api/client-portal-enhanced/invoices',
  '/api/client-portal-enhanced/invoice',
  '/api/billing/connect',
  '/api/billing/hosted-checkout',
  '/api/billing/recurring',
  '/api/payroll',
  '/api/earnings',
  '/api/timesheets',
  '/api/active-timers',
  '/api/worked-time',
  '/api/schedule',
  '/api/scheduling',
  '/api/requests',
  '/api/accounting',
  '/api/financial-intelligence',
  '/api/bulk',
  '/api/admin-invoice-profile',
];

const ENTITLED_STATUSES = ['active', 'billing_retry', 'grace'];

function isBlockedPath(requestPath) {
  return BLOCKED_PREFIXES.some(
    (prefix) =>
      requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  );
}

function resolveOrganizationId(req) {
  return (
    req.organizationContext?.organizationId ||
    req.user?.organizationId ||
    req.body?.organizationId ||
    req.query?.organizationId ||
    null
  );
}

function subscriptionGate(req, res, next) {
  if (process.env.ENTITLEMENT_GATE !== 'true') {
    return next();
  }

  const requestPath = req.originalUrl || req.path;

  // Only paid feature groups are gated. Setup/read/subscription routes pass.
  if (!isBlockedPath(requestPath)) {
    return next();
  }

  const organizationId = resolveOrganizationId(req);
  if (!organizationId) {
    // Cannot resolve an org (e.g. public/bootstrap route) — do not block.
    return next();
  }

  return Organization.findById(organizationId)
    .select('subscription')
    .then((org) => {
      const status = org?.subscription?.status || 'none';
      if (ENTITLED_STATUSES.includes(status)) {
        return next();
      }

      logger.warn('Blocked unpaid access', {
        organizationId: String(organizationId),
        status,
        path: requestPath,
      });
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message:
          'Your organization needs an active CareNest subscription to continue.',
        subscriptionStatus: status,
      });
    })
    .catch((error) => {
      logger.error('Subscription gate error', { error: error.message });
      return res.status(500).json({
        success: false,
        code: 'ENTITLEMENT_CHECK_FAILED',
        message: 'Unable to verify subscription status',
      });
    });
}

module.exports = { subscriptionGate, BLOCKED_PREFIXES };
