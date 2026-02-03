const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const InitController = require('../controllers/initController');

// Rate limiting
const initLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: 'Too many initialization requests.' }
});

// Validation
const emailParamValidation = [
    param('email').isEmail().normalizeEmail().withMessage('Valid email is required')
];

// Protected route
router.get('/initData/:email', authenticateUser, initLimiter, emailParamValidation, handleValidationErrors, InitController.getInitData);

// Legacy public route (used for login lookup)
router.get('/hello/:email', initLimiter, emailParamValidation, handleValidationErrors, InitController.hello);

module.exports = router;
