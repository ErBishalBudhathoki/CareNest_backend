const express = require('express');
const router = express.Router();
const entitlementController = require('../controllers/billing/entitlementController');
const hostedCheckoutController = require('../controllers/billing/hostedCheckoutController');
const recurringAgreementController = require('../controllers/billing/recurringAgreementController');
const recurringChargeController = require('../controllers/billing/recurringChargeController');
const stripeConnectOAuthController = require('../controllers/billing/stripeConnectOAuthController');
const { authenticateUser } = require('../middleware/auth');
const {
  organizationContextMiddleware,
  requireOrganizationMatch,
} = require('../middleware/organizationContext');
const { handleValidationErrors } = require('../middleware/validation');
const { body } = require('express-validator');
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
