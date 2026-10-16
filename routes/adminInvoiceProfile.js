const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const adminInvoiceProfileController = require('../controllers/adminInvoiceProfileController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { requireOrgMembership } = require('../middleware/requireOrgMembership');

// Rate limiting
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many admin requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const createProfileValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('businessName').trim().notEmpty().withMessage('Business name is required'),
  body('abn').optional().trim().matches(/^[0-9]{11}$/).withMessage('ABN must be 11 digits'),
  body('contactEmail').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('contactPhone').optional().trim().isMobilePhone().withMessage('Invalid phone number'),
  body('address.street').optional().trim().isLength({ max: 255 }),
  body('address.city').optional().trim().isLength({ max: 100 }),
  body('address.state').optional().trim().isLength({ max: 50 }),
  body('address.postcode').optional().trim().isLength({ max: 20 }),
  body('bankAccount.accountName').optional().trim(),
  body('bankAccount.bsb').optional().trim().matches(/^[0-9]{6}$/),
  body('bankAccount.accountNumber').optional().trim()
];

const updateProfileValidation = [
  param('profileId').isMongoId().withMessage('Valid profile ID is required'),
  body('businessName').optional().trim().notEmpty().withMessage('Business name cannot be empty'),
  body('abn').optional().trim().matches(/^[0-9]{11}$/).withMessage('ABN must be 11 digits'),
  body('contactEmail').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('contactPhone').optional().trim().isMobilePhone().withMessage('Invalid phone number'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const profileIdValidation = [
  param('profileId').isMongoId().withMessage('Valid profile ID is required')
];

// Protected routes
router.use(authenticateUser);
router.use(requireOrgMembership);
// The profile carries the organisation's business identity and its bank account
// (account name, BSB, account number) — the details invoices are paid into — and
// it is only reachable from the Admin dashboard. It was previously readable and
// writable by any member of the organisation: a two-tenant probe received the
// full profile, bank details included, for a non-admin caller.
router.use(requireRoles(['admin', 'owner']));

/**
 * Create admin invoice profile
 */
router.post('/api/admin-invoice-profile', adminLimiter, createProfileValidation, handleValidationErrors, adminInvoiceProfileController.createProfile);

/**
 * Get active admin invoice profile by organization
 */
router.get('/api/admin-invoice-profile/:organizationId', adminLimiter, organizationIdValidation, handleValidationErrors, adminInvoiceProfileController.getActiveProfile);

/**
 * Update admin invoice profile
 */
router.put('/api/admin-invoice-profile/:profileId', strictLimiter, updateProfileValidation, handleValidationErrors, adminInvoiceProfileController.updateProfile);

/**
 * Soft delete admin invoice profile
 */
router.delete('/api/admin-invoice-profile/:profileId', strictLimiter, profileIdValidation, handleValidationErrors, adminInvoiceProfileController.deleteProfile);

module.exports = router;
