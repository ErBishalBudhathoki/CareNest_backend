const express = require('express');
const userController = require('../controllers/userController');
const authController = require('../controllers/authController');
const { authenticateUser } = require('../middleware/auth');
const { param, body } = require('express-validator');
const { validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
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

// Multer configuration for photo uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

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
  userController.getAllUsers
);

/**
 * Get all users (employees) for a specific organization
 * GET /organization/:organizationId/employees
 */
router.get(
  "/organization/:organizationId/employees",
  authenticateUser,
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
  [
    param('email').isEmail().normalizeEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  authController.getInitData
);

module.exports = router;