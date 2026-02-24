const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const businessController = require('../controllers/businessController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const businessLimiter = rateLimit({
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
const addBusinessValidation = [
  body('businessName').trim().notEmpty().withMessage('Business name is required'),
  body('businessEmail').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('abn').optional().trim().matches(/^[0-9]{11}$/).withMessage('ABN must be 11 digits'),
  body('businessPhone').optional().trim().isLength({ max: 30 }),
  body('businessAddress').optional().trim().isLength({ max: 500 }),
  body('businessCity').optional().trim().isLength({ max: 100 }),
  body('businessState').optional().trim().isLength({ max: 100 }),
  body('businessZip').optional().trim().isLength({ max: 20 }),
  body('userEmail').optional().isEmail().normalizeEmail(),
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const businessIdValidation = [
  param('businessId').isMongoId().withMessage('Valid business ID is required')
];

const updateBusinessValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('userEmail').optional().isEmail().normalizeEmail(),
  body('businessName').optional().trim().notEmpty().withMessage('Business name cannot be empty'),
  body('businessEmail').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('businessPhone').optional().trim().isLength({ max: 30 }),
  body('businessAddress').optional().trim().isLength({ max: 500 }),
  body('businessCity').optional().trim().isLength({ max: 100 }),
  body('businessState').optional().trim().isLength({ max: 100 }),
  body('businessZip').optional().trim().isLength({ max: 20 }),
];

const deleteBusinessValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('userEmail').optional().isEmail().normalizeEmail(),
];

// Protected routes
router.use(authenticateUser);

/**
 * Add business with organization context
 * POST /addBusiness
 */
router.post('/addBusiness', strictLimiter, addBusinessValidation, handleValidationErrors, businessController.addBusiness);

/**
 * Get businesses for organization
 * GET /businesses/:organizationId
 */
router.get('/businesses/:organizationId', businessLimiter, organizationIdValidation, handleValidationErrors, businessController.getBusinessesByOrganization);

/**
 * Update business
 * PUT /business/:businessId
 */
router.put(
  '/business/:businessId',
  strictLimiter,
  businessIdValidation,
  updateBusinessValidation,
  handleValidationErrors,
  businessController.updateBusiness
);

/**
 * Delete (soft-delete) business
 * POST /business/:businessId/delete
 */
router.post(
  '/business/:businessId/delete',
  strictLimiter,
  businessIdValidation,
  deleteBusinessValidation,
  handleValidationErrors,
  businessController.deleteBusiness
);

module.exports = router;
