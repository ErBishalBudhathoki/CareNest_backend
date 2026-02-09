const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const organizationController = require('../controllers/organizationController');
const { authenticateUser } = require('../middleware/auth');
const { 
  organizationContextMiddleware, 
  optionalOrganizationContext 
} = require('../middleware/organizationContext');

// Rate limiting
const orgLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const createValidation = [
  body('organizationName').trim().notEmpty().withMessage('Organization name is required'),
  body('ownerEmail').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('plan').optional().isIn(['free', 'basic', 'pro', 'enterprise']).withMessage('Invalid plan type')
];

const verifyCodeValidation = [
  body('organizationCode').trim().notEmpty().withMessage('Organization code is required')
];

const updateOrgValidation = [
  body('organizationName').optional().trim().notEmpty().withMessage('Organization name cannot be empty'),
  body('address').optional().trim(),
  body('phone').optional().trim(),
  body('website').optional().trim().isURL().withMessage('Invalid website URL'),
  body('logoUrl').optional().trim().isURL().withMessage('Invalid logo URL'),
  body('timezone').optional().trim()
];

const brandingValidation = [
  body('primaryColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('secondaryColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('logoUrl').optional().trim().isURL().withMessage('Invalid logo URL'),
  body('faviconUrl').optional().trim().isURL().withMessage('Invalid favicon URL')
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Invalid organization ID')
];

// Protected routes
router.use(authenticateUser);

// General
router.post('/create', orgLimiter, optionalOrganizationContext, createValidation, handleValidationErrors, organizationController.createOrganization);
router.get('/user/my-organizations', orgLimiter, optionalOrganizationContext, organizationController.getMyOrganizations);
router.post('/verify-code', orgLimiter, optionalOrganizationContext, verifyCodeValidation, handleValidationErrors, organizationController.verifyOrganizationCode);
router.post('/switch/:organizationId', strictLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.switchOrganization);

// By ID
router.get('/:organizationId', orgLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationById);
router.put('/:organizationId', strictLimiter, organizationContextMiddleware, organizationIdValidation, updateOrgValidation, handleValidationErrors, organizationController.updateOrganizationDetails);

// Sub-resources
router.get('/:organizationId/members', orgLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationMembers);
router.get('/:organizationId/businesses', orgLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationBusinesses);
router.get('/:organizationId/clients', orgLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationClients);
router.get('/:organizationId/employees', orgLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationEmployees);

// Branding
router.get('/:organizationId/branding', orgLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.getBranding);
router.put('/:organizationId/branding', strictLimiter, organizationContextMiddleware, organizationIdValidation, brandingValidation, handleValidationErrors, organizationController.updateBranding);

// Complete Setup
router.post('/:organizationId/complete-setup', strictLimiter, organizationContextMiddleware, organizationIdValidation, handleValidationErrors, organizationController.completeSetup);

module.exports = router;
