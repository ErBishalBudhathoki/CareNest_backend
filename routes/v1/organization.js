const express = require('express');
const organizationController = require('../../controllers/organizationController');
const multiTenantController = require('../../controllers/multiTenantController');
const { authenticateUser } = require('../../middleware/auth');
const { 
  organizationContextMiddleware, 
  optionalOrganizationContext 
} = require('../../middleware/organizationContext');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Rate limiters
const organizationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many organization read requests. Please try again later.'
  }
});

const organizationWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many organization write requests. Please try again later.'
  }
});

const organizationCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 organization creations per hour
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many organization creation attempts. Please try again later.'
  }
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.param, message: e.msg }))
    });
  }
  next();
};

// Organization code regex (8-character alphanumeric uppercase)
const organizationCodeRegex = /^[A-Z0-9]{8}$/;

// MongoDB ObjectId regex
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// Validation chains
const createOrganizationValidation = [
  body('organizationName')
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Organization name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-&.,]+$/).withMessage('Organization name contains invalid characters'),
  body('ownerEmail')
    .isEmail().withMessage('Valid owner email is required')
    .normalizeEmail()
];

const createOrganizationLegacyValidation = [
  body('organizationName')
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Organization name must be between 2 and 100 characters'),
  body('ownerEmail')
    .isEmail().withMessage('Valid owner email is required')
    .normalizeEmail(),
  body('ownerFirstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('First name must be between 1 and 50 characters'),
  body('ownerLastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Last name must be between 1 and 50 characters')
];

const verifyCodeValidation = [
  body('organizationCode')
    .trim()
    .matches(organizationCodeRegex).withMessage('Organization code must be 8 alphanumeric characters')
    .toUpperCase()
];

const verifyCodeParamValidation = [
  param('organizationCode')
    .trim()
    .matches(organizationCodeRegex).withMessage('Organization code must be 8 alphanumeric characters')
];

const verifyCodeLegacyValidation = [
  param('code')
    .trim()
    .matches(organizationCodeRegex).withMessage('Organization code must be 8 alphanumeric characters')
];

const organizationIdValidation = [
  param('organizationId')
    .trim()
    .matches(objectIdRegex).withMessage('Invalid organization ID format')
];

// Apply authentication to all routes except public verification endpoints
router.use(authenticateUser);

/**
 * Create a new organization
 * POST /organization/create
 */
router.post(
  '/create',
  organizationCreateLimiter,
  optionalOrganizationContext,
  createOrganizationValidation,
  handleValidationErrors,
  organizationController.createOrganization
);

/**
 * Create a new organization (legacy endpoint)
 * POST /createOrganization
 */
router.post(
  '/createOrganization',
  organizationCreateLimiter,
  optionalOrganizationContext,
  createOrganizationLegacyValidation,
  handleValidationErrors,
  organizationController.createOrganizationLegacy
);

/**
 * Verify organization code
 * POST /organization/verify-code
 */
router.post(
  '/verify-code',
  organizationReadLimiter,
  optionalOrganizationContext,
  verifyCodeValidation,
  handleValidationErrors,
  organizationController.verifyOrganizationCode
);

/**
 * Get my organizations list
 * GET /organization/my-list
 */
router.get(
  '/my-list',
  organizationReadLimiter,
  optionalOrganizationContext,
  organizationController.getMyOrganizations
);

/**
 * Get my organizations list (Legacy/Frontend path)
 * GET /organization/user/my-organizations
 */
router.get(
  '/user/my-organizations',
  organizationReadLimiter,
  optionalOrganizationContext,
  organizationController.getMyOrganizations
);

/**
 * Get cross-organization report
 * GET /organization/cross-report
 */
router.get(
  '/cross-report',
  organizationReadLimiter,
  optionalOrganizationContext,
  multiTenantController.getCrossOrgReport
);

/**
 * Verify organization code (frontend endpoint)
 * GET /organization/verify/:organizationCode
 */
router.get(
  '/verify/:organizationCode',
  organizationReadLimiter,
  optionalOrganizationContext,
  verifyCodeParamValidation,
  handleValidationErrors,
  organizationController.verifyOrganizationCodeGet
);

/**
 * Verify organization code (legacy endpoint)
 * GET /verifyOrganizationCode/:code
 */
router.get(
  '/verifyOrganizationCode/:code',
  organizationReadLimiter,
  optionalOrganizationContext,
  verifyCodeLegacyValidation,
  handleValidationErrors,
  organizationController.verifyOrganizationCodeLegacy
);

/**
 * Get organization details
 * GET /organization/:organizationId
 */
router.get(
  '/:organizationId',
  organizationReadLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.getOrganizationById
);

/**
 * Update organization details
 * PUT /organization/:organizationId
 */
router.put(
  '/:organizationId',
  organizationWriteLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.updateOrganizationDetails
);

/**
 * Get organization members
 * GET /organization/:organizationId/members
 */
router.get(
  '/:organizationId/members',
  organizationReadLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.getOrganizationMembers
);

/**
 * Get organization businesses
 * GET /organization/:organizationId/businesses
 */
router.get(
  '/:organizationId/businesses',
  organizationReadLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.getOrganizationBusinesses
);

/**
 * Get organization clients
 * GET /organization/:organizationId/clients
 */
router.get(
  '/:organizationId/clients',
  organizationReadLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.getOrganizationClients
);

/**
 * Get organization employees
 * GET /organization/:organizationId/employees
 */
router.get(
  '/:organizationId/employees',
  organizationReadLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.getOrganizationEmployees
);

/**
 * Switch active organization
 * POST /organization/:organizationId/switch
 */
router.post(
  '/:organizationId/switch',
  organizationWriteLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.switchOrganization
);

/**
 * Get organization branding
 * GET /organization/:organizationId/branding
 */
router.get(
  '/:organizationId/branding',
  organizationReadLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.getBranding
);

/**
 * Update organization branding
 * PUT /organization/:organizationId/branding
 */
router.put(
  '/:organizationId/branding',
  organizationWriteLimiter,
  organizationContextMiddleware,
  organizationIdValidation,
  handleValidationErrors,
  organizationController.updateBranding
);

module.exports = router;
