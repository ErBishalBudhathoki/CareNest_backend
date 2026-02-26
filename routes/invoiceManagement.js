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
  body('organizationId').trim().notEmpty().withMessage('Organization ID is required'),
  body('clientEmail').isEmail().withMessage('Valid client email is required'),
  body('invoiceType')
    .optional()
    .isIn(['client', 'employee'])
    .withMessage('invoiceType must be "client" or "employee"'),
  body('lineItems')
    .isArray()
    .withMessage('lineItems must be an array'),
  body()
    .custom((payload) => {
      const lineItems = Array.isArray(payload?.lineItems) ? payload.lineItems : [];
      const expenses = Array.isArray(payload?.expenses) ? payload.expenses : [];
      if (lineItems.length === 0 && expenses.length === 0) {
        throw new Error('At least one line item or expense is required');
      }
      return true;
    }),
  body('lineItems.*')
    .custom((item) => {
      if (!item || typeof item !== 'object') {
        throw new Error('Each line item must be an object');
      }

      const description = String(
        item.description ||
        item.itemName ||
        item.supportItemName ||
        item.ndisItemName ||
        ''
      ).trim();

      const quantity = Number(item.quantity ?? item.hours ?? item.totalHours ?? 0);
      const price = Number(item.unitPrice ?? item.rate ?? item.price ?? 0);
      const total = Number(item.totalPrice ?? item.amount ?? item.total ?? 0);

      if (!description) {
        throw new Error('Line item description/name is required');
      }
      if ((Number.isNaN(quantity) || quantity <= 0) && (Number.isNaN(total) || total <= 0)) {
        throw new Error('Line item must include a positive quantity/hours or total amount');
      }
      if ((Number.isNaN(price) || price <= 0) && (Number.isNaN(total) || total <= 0)) {
        throw new Error('Line item must include a positive unit price/rate or total amount');
      }
      return true;
    }),
  body('financialSummary.taxAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Tax amount must be a positive number'),
  body('financialSummary.totalAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Total amount must be a positive number'),
  body('metadata.internalNotes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes too long')
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
