const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const organizationController = require('../controllers/organizationController');
const { authenticateUser } = require('../middleware/auth');

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
router.post('/create', orgLimiter, createValidation, handleValidationErrors, organizationController.createOrganization);
router.get('/user/my-organizations', orgLimiter, organizationController.getMyOrganizations);
router.post('/verify-code', orgLimiter, verifyCodeValidation, handleValidationErrors, organizationController.verifyOrganizationCode);
router.post('/switch/:organizationId', strictLimiter, organizationIdValidation, handleValidationErrors, organizationController.switchOrganization);

// By ID
router.get('/:organizationId', orgLimiter, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationById);
router.put('/:organizationId', strictLimiter, organizationIdValidation, updateOrgValidation, handleValidationErrors, organizationController.updateOrganizationDetails);

// Sub-resources
router.get('/:organizationId/members', orgLimiter, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationMembers);
router.get('/:organizationId/businesses', orgLimiter, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationBusinesses);
router.get('/:organizationId/clients', orgLimiter, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationClients);
router.get('/:organizationId/employees', orgLimiter, organizationIdValidation, handleValidationErrors, organizationController.getOrganizationEmployees);

// Branding
router.get('/:organizationId/branding', orgLimiter, organizationIdValidation, handleValidationErrors, organizationController.getBranding);
router.put('/:organizationId/branding', strictLimiter, organizationIdValidation, brandingValidation, handleValidationErrors, organizationController.updateBranding);

module.exports = router;
