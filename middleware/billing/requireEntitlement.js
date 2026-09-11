const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

/**
 * Gate to block paid features when the organization subscription has expired
 * or is revoked. The check reads the `subscription.status` field that the
 * backend sets after receipt verification; it never trusts client input.
 */
function requireEntitlement(_featureName) {
  return async (req, res, next) => {
    try {
      const orgId = req.organizationContext?.organizationId || req.body?.organizationId;
      if (!orgId) {
        return res.status(400).json({
          success: false,
          code: 'ORG_CONTEXT_REQUIRED',
          message: 'Organization context is required',
        });
      }
      const org = await Organization.findById(orgId).select('subscription');
      const status = org?.subscription?.status || 'none';
      // Active, retry, grace and 'none' (no purchase history) are all OK.
      // Only explicitly expired / revoked / refunded subscriptions block.
      if (['active', 'billing_retry', 'grace', 'none'].includes(status)) {
        return next();
      }
      logger.warn('Blocked unpaid access', {
        organizationId: orgId,
        status,
        path: req.originalUrl,
      });
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Your organization needs an active CareNest subscription to continue.',
        subscriptionStatus: status,
      });
    } catch (error) {
      logger.error('Entitlement gate error', { error: error.message });
      return res.status(500).json({
        success: false,
        code: 'ENTITLEMENT_CHECK_FAILED',
        message: 'Unable to verify subscription status',
      });
    }
  };
}

module.exports = { requireEntitlement };
