const express = require('express');
const router = express.Router();
const OnboardingController = require('../controllers/onboardingController');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

const { upload } = require('../config/storage');

/**
 * @route GET /api/onboarding/status
 * @desc Get current user's onboarding status
 * @access Private
 */
router.get('/status', authenticateUser, OnboardingController.getStatus);

/**
 * @route POST /api/onboarding/upload
 * @desc Upload a file and get the URL
 * @access Private
 */
router.post('/upload', authenticateUser, upload.single('file'), OnboardingController.handleFileUpload);

/**
 * @route PUT /api/onboarding/step/:stepName
 * @desc Update a specific onboarding step (personalDetails, bankDetails, etc.)
 * @access Private
 */
router.put('/step/:stepName', authenticateUser, OnboardingController.updateStep);

/**
 * @route POST /api/onboarding/documents
 * @desc Upload a document record
 * @access Private
 */
router.post('/documents', authenticateUser, OnboardingController.uploadDocument);

/**
 * @route GET /api/onboarding/documents
 * @desc List user's documents
 * @access Private
 */
router.get('/documents', authenticateUser, OnboardingController.getDocuments);

/**
 * @route DELETE /api/onboarding/documents/:docId
 * @desc Delete a document
 * @access Private
 */
router.delete('/documents/:docId', authenticateUser, OnboardingController.deleteDocument);

/**
 * @route PUT /api/onboarding/submit
 * @desc Submit onboarding for review
 * @access Private
 */
router.put('/submit', authenticateUser, OnboardingController.submitOnboarding);

// --- Admin Routes ---

/**
 * @route GET /api/onboarding/admin/pending
 * @desc List all pending onboardings for the organization
 * @access Admin
 */
router.get('/admin/pending', authenticateUser, requireAdmin, OnboardingController.getPendingOnboardings);

/**
 * @route GET /api/onboarding/admin/documents/:userId
 * @desc Get documents for a specific user
 * @access Admin
 */
router.get('/admin/documents/:userId', authenticateUser, requireAdmin, OnboardingController.getAdminDocuments);

/**
 * @route PUT /api/onboarding/admin/verify-document/:docId
 * @desc Approve or reject a document
 * @access Admin
 */
router.put('/admin/verify-document/:docId', authenticateUser, requireAdmin, OnboardingController.verifyDocument);

/**
 * @route PUT /api/onboarding/admin/finalize/:userId
 * @desc Complete onboarding and send welcome email
 * @access Admin
 */
router.put('/admin/finalize/:userId', authenticateUser, requireAdmin, OnboardingController.finalizeOnboarding);

/**
 * @route POST /api/onboarding/admin/check-probation
 * @desc Trigger probation period check and reminders
 * @access Admin
 */
router.post('/admin/check-probation', authenticateUser, requireAdmin, OnboardingController.checkProbationStatus);

module.exports = router;
