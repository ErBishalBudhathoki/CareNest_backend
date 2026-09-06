const recurringAgreementService = require('../../services/billing/recurringAgreementService');
const catchAsync = require('../../utils/catchAsync');
const logger = require('../../config/logger');

class RecurringAgreementController {
  /**
   * POST /api/billing/recurring-agreements
   * Body: { organizationId, invoiceId, frequency, consentAccepted,
   *         consentIp, consentUserAgent }
   * Returns a Stripe Checkout setup-mode session URL plus the agreement.
   */
  create = catchAsync(async (req, res) => {
    const { organizationId, invoiceId, frequency } = req.body;
    if (!organizationId || !invoiceId || !frequency) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'organizationId, invoiceId and frequency are required',
      });
    }
    if (!req.organizationContext?.permissions?.includes('manage_billing')) {
      return res.status(403).json({
        success: false,
        code: 'BILLING_PERMISSION_REQUIRED',
        message: 'You need the manage_billing permission to create recurring agreements',
      });
    }
    const { agreement, setupSessionUrl } = await recurringAgreementService.createConsent({
      organizationId,
      createdByUser: req.user,
      payload: req.body,
    });
    logger.info('Recurring agreement created', {
      organizationId,
      invoiceId,
      agreementId: String(agreement._id),
    });
    res.json({
      success: true,
      code: 'RECURRING_AGREEMENT_CREATED',
      agreement,
      setupSessionUrl,
      consentTextVersion: recurringAgreementService.CONSENT_TEXT_VERSION,
    });
  });

  /**
   * GET /api/billing/recurring-agreements?organizationId=...
   */
  list = catchAsync(async (req, res) => {
    const { organizationId } = req.query;
    const agreements = await recurringAgreementService.listAgreements(organizationId);
    res.json({
      success: true,
      code: 'RECURRING_AGREEMENTS_LISTED',
      agreements,
    });
  });

  /**
   * DELETE /api/billing/recurring-agreements/:agreementId
   */
  cancel = catchAsync(async (req, res) => {
    const { agreementId } = req.params;
    const { organizationId, reason } = req.query;
    const agreement = await recurringAgreementService.cancelAgreement({
      organizationId,
      agreementId,
      canceledBy: req.user?.email || 'organization-admin',
      reason: reason || 'Canceled by organization admin',
    });
    res.json({
      success: true,
      code: 'RECURRING_AGREEMENT_CANCELED',
      agreement,
    });
  });
}

module.exports = new RecurringAgreementController();
