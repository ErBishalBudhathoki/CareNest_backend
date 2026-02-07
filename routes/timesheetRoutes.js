const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const timesheetController = require('../controllers/timesheetController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { 
  organizationContextMiddleware, 
  requireOrganizationMatch 
} = require('../middleware/organizationContext');

// Rate limiting
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 exports per hour
  message: { success: false, message: 'Too many export requests, please try again later.' }
});

const listLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

// Validation
const exportValidation = [
  body('startDate').isISO8601().toDate().withMessage('Start date must be a valid date'),
  body('endDate').isISO8601().toDate().withMessage('End date must be a valid date'),
  body('organizationId').isMongoId().withMessage('Invalid organization ID'),
  body('format').optional().isIn(['csv', 'json', 'xlsx']).withMessage('Format must be csv, json, or xlsx')
];

const listValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('startDate').isISO8601().toDate().withMessage('Start date must be a valid date'),
  body('endDate').isISO8601().toDate().withMessage('End date must be a valid date'),
  body('status').optional().isIn(['draft', 'submitted', 'approved', 'rejected']).withMessage('Invalid status')
];

// Protected routes
router.use(authenticateUser);
router.use(organizationContextMiddleware);

/**
 * Get timesheet list
 * POST /api/timesheets/list
 */
router.post(
  '/list',
  listLimiter,
  requireOrganizationMatch('organizationId'),
  listValidation,
  handleValidationErrors,
  timesheetController.getTimesheets
);

/**
 * Export payroll data
 * POST /api/timesheets/export-payroll
 * Admin only
 */
router.post(
  '/export-payroll', 
  requireRoles(['admin']), 
  exportLimiter, 
  requireOrganizationMatch('organizationId'),
  exportValidation, 
  handleValidationErrors,
  timesheetController.exportPayroll
);

module.exports = router;
