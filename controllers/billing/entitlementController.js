const entitlementService = require('../../services/billing/entitlementService');
const catchAsync = require('../../utils/catchAsync');
const logger = require('../../config/logger');

class EntitlementController {
  /**
   * POST /api/billing/entitlements/verify/apple
   * Body: { organizationId, transactionJws, productId }
   * Authorization: organization admin (manage_billing)
   */
  verifyApple = catchAsync(async (req, res) => {
    const { organizationId, transactionJws, productId } = req.body;
    if (!organizationId || !transactionJws) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'organizationId and transactionJws are required',
      });
    }
    if (!req.organizationContext?.permissions?.includes('manage_billing')) {
      return res.status(403).json({
        success: false,
        code: 'BILLING_PERMISSION_REQUIRED',
        message: 'You need the manage_billing permission to verify purchases',
      });
    }
    if (!entitlementService.appleConfigured()) {
      return res.status(503).json({
        success: false,
        code: 'APPLE_NOT_CONFIGURED',
        message: 'Apple receipt verification is not configured on the server',
      });
    }
    const { entitlement, status } = await entitlementService.verifyApple({
      organizationId,
      transactionJws,
      productId,
    });
    logger.info('Entitlement verified (Apple)', {
      organizationId,
      userId: req.user?.userId,
    });
    res.json({
      success: true,
      code: 'ENTITLEMENT_VERIFIED',
      entitlement,
      status,
    });
  });

  /**
   * POST /api/billing/entitlements/verify/google
   * Body: { organizationId, purchaseToken, productId, subscriptionId }
   */
  verifyGoogle = catchAsync(async (req, res) => {
    const { organizationId, purchaseToken, productId, subscriptionId } = req.body;
    if (!organizationId || !purchaseToken) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'organizationId and purchaseToken are required',
      });
    }
    if (!req.organizationContext?.permissions?.includes('manage_billing')) {
      return res.status(403).json({
        success: false,
        code: 'BILLING_PERMISSION_REQUIRED',
        message: 'You need the manage_billing permission to verify purchases',
      });
    }
    if (!entitlementService.googleConfigured()) {
      return res.status(503).json({
        success: false,
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google receipt verification is not configured on the server',
      });
    }
    const { entitlement, status } = await entitlementService.verifyGoogle({
      organizationId,
      purchaseToken,
      productId,
      subscriptionId,
    });
    logger.info('Entitlement verified (Google)', {
      organizationId,
      userId: req.user?.userId,
    });
    res.json({
      success: true,
      code: 'ENTITLEMENT_VERIFIED',
      entitlement,
      status,
    });
  });

  /**
   * GET /api/billing/entitlements?organizationId=...
   * Returns the current effective entitlement state for the organization.
   */
  getStatus = catchAsync(async (req, res) => {
    const { organizationId } = req.query;
    const status = await entitlementService.refreshOrganizationStatus(organizationId);
    res.json({
      success: true,
      code: 'ENTITLEMENT_STATUS',
      status,
    });
  });
}

module.exports = new EntitlementController();
