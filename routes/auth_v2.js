const express = require('express');
const AuthController = require('../controllers/authController_v2');
const { rateLimitMiddleware, authenticateUser } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Rate limiting configurations
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

// Validation rules
const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('organizationName').optional().trim()
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

const refreshTokenValidation = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required')
];

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
];

/**
 * @route POST /api/v2/auth/register
 */
router.post('/register',
    rateLimitMiddleware('register'),
    strictLimiter,
    registerValidation,
    handleValidationErrors,
    AuthController.register
);

/**
 * @route POST /api/v2/auth/login
 */
router.post('/login',
    rateLimitMiddleware('login'),
    strictLimiter,
    loginValidation,
    handleValidationErrors,
    AuthController.login
);

/**
 * @route POST /api/v2/auth/refresh-token
 */
router.post('/refresh-token',
    rateLimitMiddleware('refresh'),
    standardLimiter,
    refreshTokenValidation,
    handleValidationErrors,
    AuthController.refreshToken
);

/**
 * @route POST /api/v2/auth/logout
 */
router.post('/logout',
    standardLimiter,
    AuthController.logout
);

/**
 * @route GET /api/v2/auth/me
 * Protected route example
 */
router.get('/me',
    authenticateUser,
    standardLimiter,
    (req, res) => {
        res.json({ success: true, user: req.user });
    }
);

/**
 * @route POST /api/v2/auth/change-password
 */
router.post('/change-password',
    authenticateUser,
    standardLimiter,
    changePasswordValidation,
    handleValidationErrors,
    AuthController.changePassword
);

module.exports = router;
