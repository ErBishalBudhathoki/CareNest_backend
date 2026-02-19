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
  body('phone').optional().trim().isMobilePhone().withMessage('Invalid phone number'),
  body('address').optional().trim().isLength({ max: 500 })
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
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

module.exports = router;
