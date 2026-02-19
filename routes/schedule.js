/**
 * Schedule Routes
 * Express router for scheduling endpoints
 * 
 * @file backend/routes/schedule.js
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const ScheduleController = require('../controllers/scheduleController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const scheduleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many scheduling requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const shiftValidation = [
  body('organizationId').isMongoId().withMessage('Invalid organization ID'),
  body('startTime').isISO8601().toDate().withMessage('Invalid start time'),
  body('endTime').isISO8601().toDate().withMessage('Invalid end time'),
  body('clientEmail').optional().isEmail().normalizeEmail().withMessage('Invalid client email'),
  body('employeeEmail').optional().isEmail().normalizeEmail().withMessage('Invalid employee email'),
  body('location').optional().trim().isLength({ max: 255 }),
  body('notes').optional().trim().isLength({ max: 1000 })
];

const bulkValidation = [
  body('shifts').isArray({ min: 1 }).withMessage('Shifts must be a non-empty array'),
  body('shifts.*.startTime').isISO8601().withMessage('Each shift must have a valid start time'),
  body('shifts.*.endTime').isISO8601().withMessage('Each shift must have a valid end time'),
  body('organizationId').optional().isMongoId()
];

const recommendationValidation = [
  query('organizationId').isMongoId().withMessage('Invalid organization ID'),
  query('startTime').isISO8601().toDate().withMessage('Invalid start time'),
  query('endTime').isISO8601().toDate().withMessage('Invalid end time'),
  query('clientId').optional().isMongoId()
];

const conflictValidation = [
  body('startTime').isISO8601().toDate().withMessage('Invalid start time'),
  body('endTime').isISO8601().toDate().withMessage('Invalid end time'),
  body('employeeEmail').optional().isEmail().normalizeEmail().withMessage('Invalid employee email')
];

const deployValidation = [
  body('templateId').isMongoId().withMessage('Invalid template ID'),
  body('startDate').isISO8601().toDate().withMessage('Invalid start date'),
  body('endDate').isISO8601().toDate().withMessage('Invalid end date')
];

const shiftIdValidation = [
  param('id').isMongoId().withMessage('Invalid shift ID')
];

const orgIdValidation = [
  param('organizationId').isMongoId().withMessage('Invalid organization ID')
];

// Apply authentication to all routes
router.use(authenticateUser);

// Shift Management
router.post('/shift', strictLimiter, shiftValidation, handleValidationErrors, ScheduleController.createShift);
router.post('/bulk', strictLimiter, bulkValidation, handleValidationErrors, ScheduleController.bulkDeploy);
router.get('/shifts/:organizationId', scheduleLimiter, orgIdValidation, handleValidationErrors, ScheduleController.getShifts);
router.put('/shift/:id', strictLimiter, shiftIdValidation, shiftValidation, handleValidationErrors, ScheduleController.updateShift);
router.delete('/shift/:id', strictLimiter, shiftIdValidation, handleValidationErrors, ScheduleController.deleteShift);

// AI Recommendations
router.get('/recommendations', scheduleLimiter, recommendationValidation, handleValidationErrors, ScheduleController.getRecommendations);
router.post('/check-conflicts', scheduleLimiter, conflictValidation, handleValidationErrors, ScheduleController.checkConflicts);

// Roster Template
router.post('/deploy-template', strictLimiter, deployValidation, handleValidationErrors, ScheduleController.deployTemplate);

module.exports = router;
