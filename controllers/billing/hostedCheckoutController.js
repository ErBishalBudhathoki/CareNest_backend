const hostedCheckoutService = require('../../services/billing/hostedCheckoutService');
const catchAsync = require('../../utils/catchAsync');
const logger = require('../../config/logger');

class HostedCheckoutController {
  /**
   * POST /api/billing/hosted-checkout/grant
   * Authenticated organization member requests a hosted payment link.
   */
  createGrant = catchAsync(async (req, res) => {
    const { organizationId, invoiceId, ttlMinutes } = req.body;
    if (!organizationId || !invoiceId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'organizationId and invoiceId are required',
      });
    }
    const { grant, plainToken } = await hostedCheckoutService.createGrant({
      organizationId,
      invoiceId,
      createdBy: req.user?.email || 'organization-admin',
      ttlMinutes,
    });
    logger.info('Hosted checkout grant created', {
      organizationId,
      invoiceId,
      grantId: String(grant._id),
    });
    res.json({
      success: true,
      code: 'HOSTED_CHECKOUT_GRANT_CREATED',
      plainToken,
      amountCents: grant.amountCents,
      currency: grant.currency,
      expiresAt: grant.expiresAt,
    });
  });

  /**
   * Public POST /api/public/checkout/session
   * Body: { token, successUrl, cancelUrl }
   * Returns the Stripe Checkout Session URL that the client can open.
   */
  createSession = catchAsync(async (req, res) => {
    const { token, successUrl, cancelUrl } = req.body;
    if (!token) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'token is required',
      });
    }
    const { url, sessionId } = await hostedCheckoutService.createCheckoutSession({
      plainToken: token,
      successUrl,
      cancelUrl,
    });
    res.json({
      success: true,
      code: 'HOSTED_CHECKOUT_SESSION',
      url,
      sessionId,
    });
  });
}

module.exports = new HostedCheckoutController();
