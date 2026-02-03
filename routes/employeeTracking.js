const express = require('express');
const EmployeeTrackingController = require('../controllers/employeeTrackingController');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many tracking requests.' }
});

// Validation
const orgValidation = [
  param('organizationId').isMongoId().withMessage('Invalid organization ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('status').optional().isIn(['active', 'inactive', 'on_leave', 'terminated']).withMessage('Invalid status')
];

// Protected routes
router.use(authenticateUser);

/**
 * Employee Tracking API Endpoint
 * GET /api/employee-tracking/:organizationId
 */
router.get(
  '/api/employee-tracking/:organizationId', 
  trackingLimiter, 
  orgValidation, 
  handleValidationErrors,
  EmployeeTrackingController.getEmployeeTrackingData
);

module.exports = router;
