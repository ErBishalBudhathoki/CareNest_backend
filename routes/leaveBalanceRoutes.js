const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const LeaveBalanceController = require('../controllers/leaveBalanceController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const leaveBalanceLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many leave balance requests.' }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const userEmailValidation = [
    param('userEmail').isEmail().normalizeEmail().withMessage('Valid email is required')
];

const updateBalanceValidation = [
    param('userEmail').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('leaveType').trim().notEmpty().withMessage('Leave type is required'),
    body('leaveType').isLength({ max: 50 }).withMessage('Leave type too long'),
    body('days').isFloat({ min: -100, max: 100 }).withMessage('Days must be between -100 and 100'),
    body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason too long'),
    body('effectiveDate').optional().isISO8601().withMessage('Invalid effective date'),
    body('expiryDate').optional().isISO8601().withMessage('Invalid expiry date')
];

router.get('/:userEmail', authenticateUser, leaveBalanceLimiter, userEmailValidation, handleValidationErrors, LeaveBalanceController.getBalances);
router.put('/:userEmail', authenticateUser, strictLimiter, updateBalanceValidation, handleValidationErrors, LeaveBalanceController.updateBalance);

module.exports = router;
