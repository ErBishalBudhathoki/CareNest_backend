const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin, requireOrganizationMatch } = require('../middleware/rbac');
const { 
  organizationContextMiddleware, 
  requireOrganizationOwnership 
} = require('../middleware/organizationContext');
const {
  getInvoicesList,
  getInvoiceDetails,
  shareInvoice,
  deleteInvoice,
  createInvoice,
  updatePaymentStatus,
  getInvoiceStats
} = require('../endpoints/invoice_management_endpoints');

// Rate limiting configurations
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
const createInvoiceValidation = [
  body('clientId').isMongoId().withMessage('Valid client ID is required'),
  body('invoiceNumber').trim().notEmpty().withMessage('Invoice number is required'),
  body('issueDate').isISO8601().withMessage('Valid issue date is required'),
  body('dueDate').isISO8601().withMessage('Valid due date is required'),
  body('lineItems').isArray({ min: 1 }).withMessage('At least one line item is required'),
  body('lineItems.*.description').trim().notEmpty().withMessage('Line item description is required'),
  body('lineItems.*.quantity').isFloat({ min: 0 }).withMessage('Valid quantity is required'),
  body('lineItems.*.unitPrice').isFloat({ min: 0 }).withMessage('Valid unit price is required'),
  body('taxRate').optional().isFloat({ min: 0, max: 100 }).withMessage('Tax rate must be between 0 and 100'),
  body('notes').optional().trim().isLength({ max: 2000 }).withMessage('Notes too long')
];

const getInvoicesValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('status').optional().isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled']).withMessage('Invalid status'),
  query('clientId').optional().isMongoId().withMessage('Invalid client ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

const invoiceIdValidation = [
  param('invoiceId').isMongoId().withMessage('Invalid invoice ID')
];

const updatePaymentValidation = [
  param('invoiceId').isMongoId().withMessage('Invalid invoice ID'),
  body('status').isIn(['pending', 'paid', 'partial', 'overdue', 'cancelled']).withMessage('Invalid payment status'),
  body('amountPaid').optional().isFloat({ min: 0 }).withMessage('Amount paid must be positive'),
  body('paymentDate').optional().isISO8601().withMessage('Invalid payment date'),
  body('paymentMethod').optional().trim().isLength({ max: 50 }).withMessage('Payment method too long')
];

const shareInvoiceValidation = [
  param('invoiceId').isMongoId().withMessage('Invalid invoice ID'),
  body('recipientEmail').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('message').optional().trim().isLength({ max: 1000 }).withMessage('Message too long'),
  body('includePdf').optional().isBoolean().withMessage('Include PDF must be a boolean')
];

const statsValidation = [
  param('organizationId').isMongoId().withMessage('Invalid organization ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

// Create a new invoice
router.post('/api/invoices', 
  authenticateUser, 
  organizationContextMiddleware,
  standardLimiter, 
  createInvoiceValidation, 
  handleValidationErrors, 
  createInvoice
);

// Get list of invoices for an organization
router.get('/api/invoices', 
  authenticateUser, 
  organizationContextMiddleware,
  standardLimiter, 
  getInvoicesValidation, 
  handleValidationErrors, 
  getInvoicesList
);

// Get details of a specific invoice
router.get('/api/invoices/:invoiceId', 
  authenticateUser, 
  organizationContextMiddleware,
  requireOrganizationOwnership('invoiceId', () => require('../models/Invoice')),
  standardLimiter, 
  invoiceIdValidation, 
  handleValidationErrors, 
  getInvoiceDetails
);

// Update payment status
router.patch('/api/invoices/:invoiceId/payment-status', 
  authenticateUser, 
  organizationContextMiddleware,
  requireOrganizationOwnership('invoiceId', () => require('../models/Invoice')),
  strictLimiter, 
  updatePaymentValidation, 
  handleValidationErrors, 
  updatePaymentStatus
);

// Share an invoice
router.post('/api/invoices/:invoiceId/share', 
  authenticateUser, 
  organizationContextMiddleware,
  requireOrganizationOwnership('invoiceId', () => require('../models/Invoice')),
  standardLimiter, 
  shareInvoiceValidation, 
  handleValidationErrors, 
  shareInvoice
);

// Share an invoice as PDF
router.post('/api/invoices/:invoiceId/share/pdf', 
  authenticateUser, 
  organizationContextMiddleware,
  requireOrganizationOwnership('invoiceId', () => require('../models/Invoice')),
  standardLimiter, 
  shareInvoiceValidation, 
  handleValidationErrors, 
  shareInvoice
);

// Delete an invoice
router.delete('/api/invoices/:invoiceId', 
  authenticateUser, 
  organizationContextMiddleware,
  requireOrganizationOwnership('invoiceId', () => require('../models/Invoice')),
  strictLimiter, 
  invoiceIdValidation, 
  handleValidationErrors, 
  deleteInvoice
);

// Get invoice statistics
router.get(
  '/api/invoices/stats/:organizationId',
  authenticateUser,
  organizationContextMiddleware,
  standardLimiter,
  requireAdmin,
  requireOrganizationMatch('organizationId'),
  statsValidation,
  handleValidationErrors,
  getInvoiceStats
);

module.exports = router;
