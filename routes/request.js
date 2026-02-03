const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const requestController = require('../controllers/requestController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many request operations.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation
const createValidation = [
  body('organizationId').isMongoId().withMessage('Invalid organization ID'),
  body('userId').isMongoId().withMessage('Invalid user ID'),
  body('type').isIn(['Shift', 'TimeOff', 'SHIFT_SWAP_OFFER', 'SHIFT_OFFER']).withMessage('Invalid request type'),
  body('details').isObject().withMessage('Details must be an object'),
  body('details.startTime').optional().isISO8601().withMessage('Invalid start time'),
  body('details.endTime').optional().isISO8601().withMessage('Invalid end time'),
  body('details.reason').optional().trim().isLength({ max: 500 })
];

const statusValidation = [
  param('requestId').isMongoId().withMessage('Invalid request ID'),
  body('status').isIn(['Approved', 'Declined', 'Cancelled', 'Claimed']).withMessage('Invalid status'),
  body('userEmail').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('notes').optional().trim().isLength({ max: 500 })
];

const claimValidation = [
  param('requestId').isMongoId().withMessage('Invalid request ID'),
  body('claimantId').isMongoId().withMessage('Invalid claimant ID'),
  body('userEmail').isEmail().normalizeEmail().withMessage('Valid email is required')
];

const forecastValidation = [
  param('userEmail').isEmail().normalizeEmail().withMessage('Invalid email format'),
  query('targetDate').isISO8601().toDate().withMessage('Valid target date is required')
];

const calcValidation = [
  body('startDate').isISO8601().toDate().withMessage('Valid start date is required'),
  body('endDate').isISO8601().toDate().withMessage('Valid end date is required'),
  body('dailyHours').optional().isFloat({ min: 0, max: 24 }).withMessage('Daily hours must be between 0 and 24')
];

const organizationIdValidation = [
  param('organizationId').isMongoId().withMessage('Invalid organization ID')
];

// Protected routes
router.use(authenticateUser);

router.post('/create', strictLimiter, createValidation, handleValidationErrors, requestController.createRequest);
router.get('/organization/:organizationId', requestLimiter, organizationIdValidation, handleValidationErrors, requestController.getRequests);
router.patch('/:requestId/status', strictLimiter, statusValidation, handleValidationErrors, requestController.updateRequestStatus);
router.put('/:requestId/status', strictLimiter, statusValidation, handleValidationErrors, requestController.updateRequestStatus);
router.post('/:requestId/claim', strictLimiter, claimValidation, handleValidationErrors, requestController.claimRequest);
router.get('/forecast/:userEmail', requestLimiter, forecastValidation, handleValidationErrors, requestController.getLeaveForecast);
router.post('/calculate-hours', requestLimiter, calcValidation, handleValidationErrors, requestController.calculateLeaveHours);

module.exports = router;
