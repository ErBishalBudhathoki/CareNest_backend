const stripeDashboardService = require('../../services/billing/stripeDashboardService');
const catchAsync = require('../../utils/catchAsync');
const logger = require('../../config/logger');

/**
 * In-app Stripe revenue dashboard (read-only, plus dev-gated refunds).
 *
 * Every method requires the `manage_billing` permission and is scoped to the
 * organisation resolved by `organizationContextMiddleware` — never to an id
 * supplied by the client alone (`requireOrganizationMatch` enforces equality).
 */
class StripeDashboardController {
  _requireBilling(req, res) {
    if (!req.organizationContext?.permissions?.includes('manage_billing')) {
      res.status(403).json({
        success: false,
        code: 'BILLING_PERMISSION_REQUIRED',
        message: 'You need the manage_billing permission to view payment data',
      });
      return null;
    }
    return req.organizationContext.organizationId;
  }

  _sendError(res, error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      code: error.code || 'DASHBOARD_ERROR',
      message: error.message || 'Failed to load payment data',
    });
  }

  overview = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    try {
      const data = await stripeDashboardService.getAccountOverview({
        organizationId,
      });
      res.json({ success: true, code: 'DASHBOARD_OVERVIEW', data });
    } catch (error) {
      logger.warn('Dashboard overview failed', {
        organizationId: String(organizationId),
        error: error.message,
      });
      this._sendError(res, error);
    }
  });

  balance = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    try {
      const data = await stripeDashboardService.getBalance({ organizationId });
      res.json({ success: true, code: 'DASHBOARD_BALANCE', data });
    } catch (error) {
      this._sendError(res, error);
    }
  });

  payouts = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    try {
      const data = await stripeDashboardService.listPayouts({
        organizationId,
        limit: req.query.limit,
        startingAfter: req.query.starting_after,
      });
      res.json({ success: true, code: 'DASHBOARD_PAYOUTS', data });
    } catch (error) {
      this._sendError(res, error);
    }
  });

  revenue = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    try {
      const data = await stripeDashboardService.getRevenueSeries({
        organizationId,
        days: req.query.days,
      });
      res.json({ success: true, code: 'DASHBOARD_REVENUE', data });
    } catch (error) {
      this._sendError(res, error);
    }
  });

  payments = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    try {
      const data = await stripeDashboardService.listRecentPayments({
        organizationId,
        limit: req.query.limit,
      });
      res.json({ success: true, code: 'DASHBOARD_PAYMENTS', data });
    } catch (error) {
      this._sendError(res, error);
    }
  });

  risk = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    try {
      const data = await stripeDashboardService.getRisk({ organizationId });
      res.json({ success: true, code: 'DASHBOARD_RISK', data });
    } catch (error) {
      this._sendError(res, error);
    }
  });

  /**
   * DEV ONLY: issue a full or partial refund. The service throws unless
   * ENABLE_INAPP_REFUNDS=true (unset in production); the flag is re-checked
   * here so the response code stays explicit.
   */
  refund = catchAsync(async (req, res) => {
    const organizationId = this._requireBilling(req, res);
    if (!organizationId) return;
    if (!stripeDashboardService.refundsEnabled()) {
      return res.status(403).json({
        success: false,
        code: 'REFUNDS_DISABLED',
        message: 'In-app refunds are disabled',
      });
    }
    const { invoiceId, amount } = req.body;
    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'invoiceId is required',
      });
    }
    try {
      const data = await stripeDashboardService.createRefund({
        organizationId,
        invoiceId,
        amount,
      });
      logger.info('Dashboard refund completed', {
        organizationId: String(organizationId),
        invoiceId: String(invoiceId),
        refundId: data.refundId,
      });
      res.json({ success: true, code: 'REFUND_ISSUED', data });
    } catch (error) {
      this._sendError(res, error);
    }
  });
}

module.exports = new StripeDashboardController();
