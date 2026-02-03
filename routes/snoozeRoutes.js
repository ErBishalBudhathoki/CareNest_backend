const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const SnoozeController = require('../controllers/snoozeController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const snoozeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many snooze requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const createRuleValidation = [
  body('name').trim().notEmpty().withMessage('Rule name is required'),
  body('name').isLength({ max: 100 }).withMessage('Name too long'),
  body('conditions').isObject().withMessage('Conditions must be an object'),
  body('duration').isInt({ min: 1, max: 1440 }).withMessage('Duration must be between 1 and 1440 minutes'),
  body('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

const getRulesValidation = [
  query('organizationId').optional().isMongoId().withMessage('Invalid organization ID'),
  query('active').optional().isBoolean().withMessage('Active must be a boolean')
];

const checkSnoozeValidation = [
  body('userId').optional().isMongoId().withMessage('Invalid user ID'),
  body('type').trim().notEmpty().withMessage('Type is required'),
  body('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

router.use(authenticateUser);

router.post('/rules', strictLimiter, createRuleValidation, handleValidationErrors, SnoozeController.createRule);
router.get('/rules', snoozeLimiter, getRulesValidation, handleValidationErrors, SnoozeController.getRules);
router.post('/check', snoozeLimiter, checkSnoozeValidation, handleValidationErrors, SnoozeController.checkSnooze);

module.exports = router;
