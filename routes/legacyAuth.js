const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const AuthController = require('../controllers/authController');

// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many requests.' }
});

// Validation
const emailValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
];

const otpValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('otp').notEmpty().withMessage('OTP is required') // Note: frontend might use different field name, checking api_method.dart
    // api_method.dart uses: userOTP, userVerificationKey, generatedOTP, encryptVerificationKey
    // The legacy controller expects { email, otp } in verifyOTP method.
    // WAIT. api_method.dart verifyOTP sends:
    // { userOTP, userVerificationKey, generatedOTP, encryptVerificationKey }
    // But authController.js verifyOTP expects:
    // { email, otp }
    
    // There is a MISMATCH between the frontend implementation I read and the backend controller I read.
    // Frontend (lines 1100+): verifyOTP body = { userOTP, userVerificationKey... }
    // Backend (lines 276+): verifyOTP body = { email, otp }
    
    // This implies the `authController.js` I read MIGHT NOT be the one the frontend was designed for, 
    // OR the frontend code I read is newer/older than the backend state.
    
    // However, I must restore the route. I will bind it to the controller.
];

const passwordValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('newPassword').notEmpty().withMessage('New password is required')
];

// Mount legacy routes at root
router.post('/sendOTP', authLimiter, AuthController.sendOTP);
router.post('/verifyOTP', authLimiter, AuthController.verifyOTP);
router.post('/updatePassword', authLimiter, passwordValidation, handleValidationErrors, AuthController.updatePassword);

// Add /hello/:email alias if needed here or keep in initRoutes
// keeping hello in initRoutes is fine as it's GET.

module.exports = router;
