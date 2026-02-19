const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const configController = require('../controllers/configController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const configLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

// Validation
const roleValidation = [
  body('title').trim().notEmpty().withMessage('Role title is required'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('level').optional().isInt({ min: 1 }).withMessage('Level must be a positive integer'),
  body('permissions').optional().isArray()
];

const leaveValidation = [
  body('name').trim().notEmpty().withMessage('Leave type name is required'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('defaultDays').optional().isInt({ min: 0 }).withMessage('Default days must be a positive integer'),
  body('requiresApproval').optional().isBoolean()
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

// Protected routes
router.use(authenticateUser);

// Job Roles
router.get('/job-roles/:organizationId', configLimiter, organizationIdValidation, handleValidationErrors, configController.getJobRoles);
router.post('/job-roles', strictLimiter, roleValidation, handleValidationErrors, configController.createJobRole);

// Leave Types
router.get('/leave-types/:organizationId', configLimiter, organizationIdValidation, handleValidationErrors, configController.getLeaveTypes);
router.post('/leave-types', strictLimiter, leaveValidation, handleValidationErrors, configController.createLeaveType);

// System Configs
router.get('/tax-brackets', configLimiter, configController.getTaxBrackets);

module.exports = router;
