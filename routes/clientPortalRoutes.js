const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const clientPortalController = require('../controllers/clientPortalController');
const { authenticateUser, requireRoles } = require('../middleware/auth');

// Rate limiting configurations
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const activateValidation = [
  body('activationCode').trim().notEmpty().withMessage('Activation code is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

const invoiceIdValidation = [
  param('id').isMongoId().withMessage('Invalid invoice ID')
];

const appointmentRequestValidation = [
  body('workerId').optional().isMongoId().withMessage('Invalid worker ID'),
  body('preferredDate').optional().isISO8601().withMessage('Invalid date format'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes too long')
];

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
];

const disputeValidation = [
  param('id').isMongoId().withMessage('Invalid invoice ID'),
  body('reason').trim().notEmpty().withMessage('Dispute reason is required'),
  body('details').optional().trim().isLength({ max: 2000 }).withMessage('Details too long')
];

// Public routes
router.post('/auth/activate', publicLimiter, activateValidation, handleValidationErrors, clientPortalController.activate);
router.post('/auth/login', publicLimiter, loginValidation, handleValidationErrors, clientPortalController.login);

// Protected routes (Require Client Role)
router.use(authenticateUser);
router.use(requireRoles(['client']));

// Invoices
router.get('/invoices', standardLimiter, clientPortalController.getInvoices);
router.get('/invoices/:id', standardLimiter, invoiceIdValidation, handleValidationErrors, clientPortalController.getInvoiceDetail);
router.post('/invoices/:id/approve', strictLimiter, invoiceIdValidation, handleValidationErrors, clientPortalController.approveInvoice);
router.post('/invoices/:id/dispute', strictLimiter, disputeValidation, handleValidationErrors, clientPortalController.disputeInvoice);

// Appointments
router.get('/appointments', standardLimiter, clientPortalController.getAppointments);
router.get('/appointments/:assignmentId/:scheduleId', standardLimiter, 
  param('assignmentId').isMongoId().withMessage('Invalid assignment ID'),
  param('scheduleId').isMongoId().withMessage('Invalid schedule ID'),
  handleValidationErrors,
  clientPortalController.getAppointmentDetail
);
router.post('/appointments/request', standardLimiter, appointmentRequestValidation, handleValidationErrors, clientPortalController.requestAppointment);

// Account
router.post('/auth/change-password', strictLimiter, changePasswordValidation, handleValidationErrors, clientPortalController.changePassword);

module.exports = router;
