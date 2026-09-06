const stripeConnectOAuthService = require('../../services/billing/stripeConnectOAuthService');
const catchAsync = require('../../utils/catchAsync');
const logger = require('../../config/logger');

class StripeConnectOAuthController {
  /**
   * POST /api/billing/connect/oauth/start
   * Body: { organizationId }
   * Returns the Stripe Connect OAuth URL the admin should open in a browser.
   */
  start = catchAsync(async (req, res) => {
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'organizationId is required',
      });
    }
    if (!req.organizationContext?.permissions?.includes('manage_billing')) {
      return res.status(403).json({
        success: false,
        code: 'BILLING_PERMISSION_REQUIRED',
        message: 'You need the manage_billing permission to connect Stripe',
      });
    }
    const { url } = await stripeConnectOAuthService.createAuthorizationUrl({
      organizationId,
      userId: req.user.userId,
    });
    logger.info('Stripe Connect OAuth started', {
      organizationId,
      userId: req.user.userId,
    });
    res.json({
      success: true,
      code: 'STRIPE_OAUTH_STARTED',
      url,
    });
  });

  /**
   * Public GET /api/public/connect/oauth/callback
   * Stripe redirects the admin's browser back here after consent.
   */
  callback = catchAsync(async (req, res) => {
    const { code, state, error, organizationId } = req.query;
    if (error) {
      return res.status(400).send(this._renderErrorPage(error));
    }
    if (!code || !state || !organizationId) {
      return res.status(400).send(
        this._renderErrorPage('Missing required callback parameters')
      );
    }
    try {
      const result = await stripeConnectOAuthService.consumeStateAndExchange({
        code,
        state,
        organizationId,
      });
      res.send(
        this._renderSuccessPage({
          organizationId,
          detailsSubmitted: result.detailsSubmitted,
          chargesEnabled: result.chargesEnabled,
        })
      );
    } catch (err) {
      logger.warn('Stripe Connect OAuth callback failed', { error: err.message });
      res.status(400).send(this._renderErrorPage(err.message));
    }
  });

  _renderSuccessPage({ organizationId, detailsSubmitted, chargesEnabled }) {
    return `<!doctype html><html><body style="font-family: system-ui; padding: 40px; text-align: center;">
      <h1 style="color: #0DA85E;">Stripe account connected</h1>
      <p>Organization <code>${organizationId}</code> is now linked.</p>
      <p>Charges enabled: <strong>${chargesEnabled ? 'Yes' : 'Pending'}</strong>.<br/>
         Details submitted: <strong>${detailsSubmitted ? 'Yes' : 'Pending'}</strong>.</p>
      <p>You can close this window and return to the CareNest app.</p>
    </body></html>`;
  }

  _renderErrorPage(message) {
    return `<!doctype html><html><body style="font-family: system-ui; padding: 40px; text-align: center;">
      <h1 style="color: #D32F2F;">Stripe connection could not be completed</h1>
      <p>${message}</p>
      <p>Please close this window and try again from the CareNest app.</p>
    </body></html>`;
  }
}

module.exports = new StripeConnectOAuthController();
