const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { query, body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const assignmentController = require('../controllers/assignmentController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const assignmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many assignment requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const createAssignmentValidation = [
  body('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
  body('clientEmail').isEmail().normalizeEmail().withMessage('Valid client email is required'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('dateList').isArray({ min: 1 }).withMessage('Date list must be a non-empty array'),
  body('dateList.*').isISO8601().withMessage('Each date must be a valid ISO date'),
  body('startTimeList').isArray({ min: 1 }).withMessage('Start time list must be a non-empty array'),
  body('startTimeList.*').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Each start time must be in HH:MM format'),
  body('endTimeList').isArray({ min: 1 }).withMessage('End time list must be a non-empty array'),
  body('endTimeList.*').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Each end time must be in HH:MM format'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes too long')
];

const getAssignmentsValidation = [
  query('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('status').optional().isIn(['active', 'completed', 'cancelled']).withMessage('Invalid status')
];

const deleteAssignmentValidation = [
  param('id').isMongoId().withMessage('Valid assignment ID is required')
];

// Protected routes
router.use(authenticateUser);

/**
 * Create or Update Assignment
 * POST /api/assignments
 */
router.post(
    '/',
    strictLimiter,
    createAssignmentValidation,
    handleValidationErrors,
    assignmentController.createAssignment
);

/**
 * Get organization assignments
 * GET /api/assignments
 */
router.get(
  '/',
  assignmentLimiter,
  getAssignmentsValidation,
  handleValidationErrors,
  assignmentController.getOrganizationAssignments
);

/**
 * Delete assignment
 * DELETE /api/assignments/:id
 */
router.delete(
    '/:id',
    strictLimiter,
    deleteAssignmentValidation,
    handleValidationErrors,
    assignmentController.deleteAssignment
);

module.exports = router;
