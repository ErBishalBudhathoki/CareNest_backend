const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const controller = require('../controllers/trainingComplianceController');
const { authenticateUser } = require('../middleware/auth');
const { upload } = require('../config/storage');

// Rate limiting
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// Validation Chains
const certificationUploadValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('name').isLength({ max: 200 }).withMessage('Name too long'),
  body('issuer').optional().trim().isLength({ max: 200 }),
  body('expiryDate').optional().isISO8601().toDate().withMessage('Invalid expiry date'),
  body('certificationNumber').optional().trim().isLength({ max: 100 })
];

const auditValidation = [
  param('id').isMongoId().withMessage('Invalid ID'),
  body('status').isIn(['active', 'expired', 'pending_approval', 'rejected']).withMessage('Invalid status'),
  body('notes').optional().trim().isLength({ max: 500 })
];

const trainingModuleValidation = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('title').isLength({ max: 200 }).withMessage('Title too long'),
  body('durationMinutes').optional().isInt({ min: 0 }).withMessage('Duration must be positive'),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('category').optional().trim().isLength({ max: 100 })
];

const progressValidation = [
  param('id').isMongoId().withMessage('Invalid training ID'),
  body('status').isIn(['not_started', 'in_progress', 'completed']).withMessage('Invalid status'),
  body('progressPercentage').isInt({ min: 0, max: 100 }).withMessage('Progress must be between 0 and 100')
];

const checklistValidation = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('title').isLength({ max: 200 }).withMessage('Title too long'),
  body('items').isArray({ min: 1 }).withMessage('Items must be a non-empty array'),
  body('items.*').trim().notEmpty().withMessage('Each item must have content'),
  body('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

const checklistStatusValidation = [
  body('checklistId').isMongoId().withMessage('Invalid checklist ID'),
  body('completedItems').isArray().withMessage('Completed items must be an array'),
  body('isCompleted').isBoolean().withMessage('isCompleted must be a boolean')
];

const getCertificationsValidation = [
  query('userId').optional().isMongoId().withMessage('Invalid user ID'),
  query('status').optional().isIn(['active', 'expired', 'pending_approval', 'rejected']).withMessage('Invalid status filter')
];

// Routes

// Certifications
router.post(
  '/certifications/upload', 
  authenticateUser, 
  writeLimiter,
  upload.single('certification'), 
  certificationUploadValidation, 
  handleValidationErrors,
  controller.uploadCertification
);

router.get(
  '/certifications', 
  authenticateUser, 
  readLimiter,
  getCertificationsValidation,
  handleValidationErrors,
  controller.getCertifications
);

router.put(
  '/certifications/:id/audit', 
  authenticateUser, 
  writeLimiter,
  auditValidation, 
  handleValidationErrors,
  controller.auditCertification
);

// Training
router.post(
  '/training', 
  authenticateUser, 
  writeLimiter,
  trainingModuleValidation, 
  handleValidationErrors,
  controller.createTrainingModule
);

router.get(
  '/training', 
  authenticateUser, 
  readLimiter,
  controller.getTrainingModules
);

router.post(
  '/training/:id/progress', 
  authenticateUser, 
  writeLimiter,
  progressValidation, 
  handleValidationErrors,
  controller.updateTrainingProgress
);

// Compliance Checklists
router.post(
  '/compliance', 
  authenticateUser, 
  writeLimiter,
  checklistValidation, 
  handleValidationErrors,
  controller.createChecklist
);

router.get(
  '/compliance', 
  authenticateUser, 
  readLimiter,
  controller.getChecklists
);

router.post(
  '/compliance/status', 
  authenticateUser, 
  writeLimiter,
  checklistStatusValidation, 
  handleValidationErrors,
  controller.updateChecklistStatus
);

module.exports = router;
