const { body } = require('express-validator');

exports.registerValidators = [
    body('email')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail(),

    body('password')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
        .matches(/\d/).withMessage('Password must contain a number')
        .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter'),

    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Passwords do not match');
        }
        return true;
    }),

    body('firstName')
        .notEmpty().withMessage('First name is required')
        .trim()
        .escape(),

    body('lastName')
        .notEmpty().withMessage('Last name is required')
        .trim()
        .escape(),

    body('phone')
        .optional()
        .isMobilePhone().withMessage('Invalid phone number'),

    body('organizationCode')
        .optional()
        .isString()
        .trim()
        .escape()
];

exports.loginValidators = [
    body('email')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail(),

    body('password')
        .notEmpty().withMessage('Password is required')
];

exports.emailValidators = [
    body('email')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail()
];

exports.verifyEmailValidators = [
    body('email')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail(),
    body('otp')
        .notEmpty().withMessage('OTP is required')
        .trim().escape()
];

exports.resetPasswordValidators = [
    body('email')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail(),
    body('otp')
        .notEmpty().withMessage('OTP is required')
        .trim().escape(),
    body('newPassword')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('confirmPassword')
        .custom((value, { req }) => {
            if (value !== req.body.newPassword) {
                throw new Error('Passwords do not match');
            }
            return true;
        })
];
