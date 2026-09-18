const express = require('express');
const router = express.Router();
const entitlementController = require('../../controllers/billing/entitlementController');
const hostedCheckoutController = require('../../controllers/billing/hostedCheckoutController');
const recurringAgreementController = require('../../controllers/billing/recurringAgreementController');
const recurringChargeController = require('../../controllers/billing/recurringChargeController');
const stripeConnectOAuthController = require('../../controllers/billing/stripeConnectOAuthController');
const stripeDashboardController = require('../../controllers/billing/stripeDashboardController');
const { authenticateUser } = require('../../middleware/auth');
const {
  organizationContextMiddleware,
  requireOrganizationMatch,
} = require('../../middleware/organizationContext');
const { handleValidationErrors } = require('../../middleware/validation');
const { body, query } = require('express-validator');
const rateLimit = require('express-rate-limit');

const billingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many billing requests.' },
});

const publicCheckoutLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many checkout requests.' },
});

// ===== Authenticated routes =====

router.post(
  '/entitlements/verify/apple',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  body('transactionJws').notEmpty(),
  handleValidationErrors,
  entitlementController.verifyApple
);

router.post(
  '/entitlements/verify/google',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  body('purchaseToken').notEmpty(),
  handleValidationErrors,
  entitlementController.verifyGoogle
);

router.get(
  '/entitlements',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  entitlementController.getStatus
);

// DEV ONLY: clears the organisation's entitlement so the subscription gate can
// be re-tested. Disabled in production.
router.post(
  '/entitlements/reset',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  handleValidationErrors,
  entitlementController.reset
);

router.post(
  '/hosted-checkout/grant',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  body('invoiceId').notEmpty(),
  handleValidationErrors,
  hostedCheckoutController.createGrant
);

router.post(
  '/recurring-agreements',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  body('invoiceId').notEmpty(),
  body('frequency').isIn(['weekly', 'fortnightly', 'monthly']),
  body('consentAccepted').isBoolean(),
  handleValidationErrors,
  recurringAgreementController.create
);

router.get(
  '/recurring-agreements',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  recurringAgreementController.list
);

router.delete(
  '/recurring-agreements/:agreementId',
  authenticateUser,
  organizationContextMiddleware,
  billingLimiter,
  recurringAgreementController.cancel
);

router.post(
  '/recurring/run',
  authenticateUser,
  organizationContextMiddleware,
  billingLimiter,
  recurringChargeController.run
);

router.post(
  '/connect/oauth/start',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  handleValidationErrors,
  stripeConnectOAuthController.start
);

// ===== In-app Stripe revenue dashboard (manage_billing, org-scoped) =====

router.get(
  '/dashboard/overview',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  query('organizationId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.overview
);

router.get(
  '/dashboard/balance',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  query('organizationId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.balance
);

router.get(
  '/dashboard/payouts',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  query('organizationId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.payouts
);

router.get(
  '/dashboard/revenue',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  query('organizationId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.revenue
);

router.get(
  '/dashboard/payments',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  query('organizationId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.payments
);

router.get(
  '/dashboard/risk',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  query('organizationId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.risk
);

// DEV ONLY: disabled in production unless ENABLE_INAPP_REFUNDS=true.
router.post(
  '/dashboard/refund',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  billingLimiter,
  body('organizationId').notEmpty(),
  body('invoiceId').notEmpty(),
  handleValidationErrors,
  stripeDashboardController.refund
);

// ===== Public routes (no auth) =====

router.post(
  '/public/checkout/session',
  publicCheckoutLimiter,
  body('token').notEmpty(),
  body('successUrl').notEmpty(),
  body('cancelUrl').notEmpty(),
  handleValidationErrors,
  hostedCheckoutController.createSession
);

module.exports = router;
