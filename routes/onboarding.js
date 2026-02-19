const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const OnboardingController = require('../controllers/onboardingController');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const { upload } = require('../config/storage');

// Rate limiting
const onboardingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many onboarding requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const updateStepValidation = [
  param('stepName').isIn(['personalDetails', 'bankDetails', 'taxDetails', 'superannuation']).withMessage('Invalid step name'),
  body('currentStep').optional().isInt({ min: 1, max: 10 }).withMessage('Current step must be between 1 and 10'),
  body('data').optional().isObject().withMessage('Data must be an object')
];

const documentValidation = [
  body('type').isIn(['passport', 'drivers_license', 'first_aid', 'ndis_screening', 'other', 'visa', 'police_check']).withMessage('Invalid document type'),
  body('fileUrl').notEmpty().withMessage('File URL is required'),
  body('fileName').optional().trim().isLength({ max: 255 }).withMessage('File name too long'),
  body('expiryDate').optional().isISO8601().withMessage('Invalid expiry date')
];

const verifyValidation = [
  param('docId').isMongoId().withMessage('Invalid document ID'),
  body('status').isIn(['verified', 'rejected']).withMessage('Status must be verified or rejected'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes too long')
];

const personalDetailsValidation = [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('phone').optional().trim().isMobilePhone().withMessage('Invalid phone number'),
  body('dateOfBirth').optional().isISO8601().withMessage('Invalid date of birth'),
  body('address').optional().trim().isLength({ max: 500 }).withMessage('Address too long')
];

const bankDetailsValidation = [
  body('accountName').trim().notEmpty().withMessage('Account name is required'),
  body('bsb').trim().matches(/^[0-9]{6}$/).withMessage('BSB must be 6 digits'),
  body('accountNumber').trim().matches(/^[0-9]{4,9}$/).withMessage('Account number must be 4-9 digits')
];

const taxDetailsValidation = [
  body('taxFileNumber').optional().trim().matches(/^[0-9]{8,9}$/).withMessage('TFN must be 8-9 digits'),
  body('abn').optional().trim().matches(/^[0-9]{11}$/).withMessage('ABN must be 11 digits'),
  body('taxFreeThreshold').optional().isBoolean().withMessage('Tax free threshold must be boolean')
];

// Protected routes
router.use(authenticateUser);

/**
 * @route GET /api/onboarding/status
 * @desc Get current user's onboarding status
 */
router.get('/status', onboardingLimiter, OnboardingController.getStatus);

/**
 * @route POST /api/onboarding/upload
 * @desc Upload a file and get the URL
 */
router.post('/upload', onboardingLimiter, upload.single('file'), OnboardingController.handleFileUpload);

/**
 * @route PUT /api/onboarding/step/:stepName
 * @desc Update a specific onboarding step
 */
router.put('/step/:stepName', onboardingLimiter, updateStepValidation, handleValidationErrors, OnboardingController.updateStep);

/**
 * @route PUT /api/onboarding/step/personalDetails
 * @desc Update personal details with validation
 */
router.put('/step/personalDetails', onboardingLimiter, personalDetailsValidation, handleValidationErrors, OnboardingController.updateStep);

/**
 * @route PUT /api/onboarding/step/bankDetails
 * @desc Update bank details with validation
 */
router.put('/step/bankDetails', onboardingLimiter, bankDetailsValidation, handleValidationErrors, OnboardingController.updateStep);

/**
 * @route PUT /api/onboarding/step/taxDetails
 * @desc Update tax details with validation
 */
router.put('/step/taxDetails', onboardingLimiter, taxDetailsValidation, handleValidationErrors, OnboardingController.updateStep);

/**
 * @route POST /api/onboarding/documents
 * @desc Upload a document record
 */
router.post('/documents', onboardingLimiter, documentValidation, handleValidationErrors, OnboardingController.uploadDocument);

/**
 * @route GET /api/onboarding/documents
 * @desc List user's documents
 */
router.get('/documents', onboardingLimiter, OnboardingController.getDocuments);

/**
 * @route DELETE /api/onboarding/documents/:docId
 * @desc Delete a document
 */
router.delete('/documents/:docId', onboardingLimiter, param('docId').isMongoId().withMessage('Invalid document ID'), handleValidationErrors, OnboardingController.deleteDocument);

/**
 * @route PUT /api/onboarding/submit
 * @desc Submit onboarding for review
 */
router.put('/submit', strictLimiter, OnboardingController.submitOnboarding);

// --- Admin Routes ---

/**
 * @route GET /api/onboarding/admin/pending
 * @desc List all pending onboardings for the organization
 */
router.get('/admin/pending', onboardingLimiter, requireAdmin, OnboardingController.getPendingOnboardings);

/**
 * @route GET /api/onboarding/admin/documents/:userId
 * @desc Get documents for a specific user
 */
router.get('/admin/documents/:userId', onboardingLimiter, requireAdmin, param('userId').isMongoId().withMessage('Invalid user ID'), handleValidationErrors, OnboardingController.getAdminDocuments);

/**
 * @route PUT /api/onboarding/admin/verify-document/:docId
 * @desc Approve or reject a document
 */
router.put('/admin/verify-document/:docId', strictLimiter, requireAdmin, verifyValidation, handleValidationErrors, OnboardingController.verifyDocument);

/**
 * @route PUT /api/onboarding/admin/finalize/:userId
 * @desc Complete onboarding and send welcome email
 */
router.put('/admin/finalize/:userId', strictLimiter, requireAdmin, param('userId').isMongoId().withMessage('Invalid user ID'), handleValidationErrors, OnboardingController.finalizeOnboarding);

/**
 * @route POST /api/onboarding/admin/check-probation
 * @desc Trigger probation period check and reminders
 */
router.post('/admin/check-probation', onboardingLimiter, requireAdmin, OnboardingController.checkProbationStatus);

module.exports = router;
