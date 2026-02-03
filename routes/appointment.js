const express = require('express');
const AppointmentController = require('../controllers/appointmentController');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { param, body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const appointmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many appointment requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const emailParam = [
  param('email').isEmail().normalizeEmail().withMessage('Valid email is required')
];

const userClientParams = [
  param('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
  param('clientEmail').isEmail().normalizeEmail().withMessage('Valid client email is required')
];

const orgParam = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const removeValidation = [
  query('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
  query('clientEmail').isEmail().normalizeEmail().withMessage('Valid client email is required')
];

const timerValidation = [
  body('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
  body('clientEmail').optional().isEmail().normalizeEmail().withMessage('Valid client email is required'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('location').optional().trim().isLength({ max: 255 }),
  body('notes').optional().trim().isLength({ max: 1000 })
];

const workedTimeValidation = [
  body('userEmail').isEmail().normalizeEmail().withMessage('Valid user email is required'),
  body('clientEmail').isEmail().normalizeEmail().withMessage('Valid client email is required'),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid start time is required (HH:MM)'),
  body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid end time is required (HH:MM)'),
  body('breakDuration').optional().isInt({ min: 0 }).withMessage('Break duration must be a positive integer (minutes)')
];

// Protected routes
router.use(authenticateUser);

/**
 * Load appointments for a user
 * GET /loadAppointments/:email
 */
router.get('/loadAppointments/:email', appointmentLimiter, emailParam, handleValidationErrors, AppointmentController.loadAppointments);

/**
 * Get appointment details for a specific user and client
 * GET /loadAppointmentDetails/:userEmail/:clientEmail
 */
router.get('/loadAppointmentDetails/:userEmail/:clientEmail', appointmentLimiter, userClientParams, handleValidationErrors, AppointmentController.loadAppointmentDetails);

/**
 * Get all assignments for an organization
 * GET /getOrganizationAssignments/:organizationId
 */
router.get('/getOrganizationAssignments/:organizationId', appointmentLimiter, orgParam, handleValidationErrors, AppointmentController.getOrganizationAssignments);

/**
 * Remove client assignment
 * DELETE /removeClientAssignment
 */
router.delete('/removeClientAssignment', strictLimiter, removeValidation, handleValidationErrors, AppointmentController.removeClientAssignment);

// ============================================================================
// TIMER ENDPOINTS (MIGRATED to /active-timers)
// ============================================================================
// Legacy endpoints removed. Use /active-timers/start, /active-timers/stop, etc.

/**
 * Set worked time for a client
 * POST /setWorkedTime
 */
router.post('/setWorkedTime', strictLimiter, workedTimeValidation, handleValidationErrors, AppointmentController.setWorkedTime);

module.exports = router;
