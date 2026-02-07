const express = require('express');
const userController = require('../controllers/userController');
const authController = require('../controllers/authController');
const { authenticateUser } = require('../middleware/auth');
const { 
  organizationContextMiddleware, 
  optionalOrganizationContext,
  requireOrganizationMatch 
} = require('../middleware/organizationContext');
const { param, body } = require('express-validator');
const { validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
// Use the configured upload middleware (R2/S3 aware) instead of memory storage
const { upload } = require('../config/storage');
const router = express.Router();

// Rate limiters
const photoReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many photo read requests.' }
});

const photoUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many photo upload requests.' }
});

// Multer configuration is now handled by config/storage.js
// const upload = multer({ ... }); removed

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * Get all users
 * GET /getUsers/
 */
router.get(
  "/getUsers/",
  authenticateUser,
  optionalOrganizationContext,
  userController.getAllUsers
);

/**
 * Get all users (employees) for a specific organization
 * GET /organization/:organizationId/employees
 */
router.get(
  "/organization/:organizationId/employees",
  authenticateUser,
  organizationContextMiddleware,
  [
    param('organizationId').isMongoId().withMessage('Invalid organization ID')
  ],
  handleValidationErrors,
  userController.getOrganizationEmployees
);

/**
 * Fix client organizationId for existing records
 * POST /fixClientOrganizationId
 */
router.post(
  '/fixClientOrganizationId',
  authenticateUser,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  [
    body('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
    body('organizationId').isMongoId().withMessage('Invalid organization ID')
  ],
  handleValidationErrors,
  userController.fixClientOrganizationId
);

/**
 * @route GET /api/user/photo/:email
 * @desc Get user photo by email
 * @access Private
 */
router.get(
  '/photo/:email',
  authenticateUser,
  optionalOrganizationContext,
  photoReadLimiter,
  [
    param('email').isEmail().normalizeEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  authController.getUserPhoto
);

/**
 * @route POST /api/user/photo
 * @desc Upload user photo
 * @access Private
 */
router.post(
  '/photo',
  authenticateUser,
  optionalOrganizationContext,
  photoUploadLimiter,
  upload.single('photo'),
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  authController.uploadPhoto
);

/**
 * @route GET /api/user/init-data/:email
 * @desc Get user initialization data
 * @access Private
 */
router.get(
  '/init-data/:email',
  authenticateUser,
  optionalOrganizationContext,
  [
    param('email').isEmail().normalizeEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  authController.getInitData
);

module.exports = router;