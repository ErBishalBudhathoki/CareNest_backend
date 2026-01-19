const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin, requireOrganizationMatch } = require('../middleware/rbac');
const {
  getInvoicesList,
  getInvoiceDetails,
  shareInvoice,
  deleteInvoice,
  createInvoice,
  updatePaymentStatus
} = require('../endpoints/invoice_management_endpoints');

const router = express.Router();

// Create a new invoice
router.post('/api/invoices', createInvoice);

// Get list of invoices for an organization
router.get('/api/invoices', getInvoicesList);

// Get details of a specific invoice
router.get('/api/invoices/:invoiceId', getInvoiceDetails);

// Update payment status
router.patch('/api/invoices/:invoiceId/payment-status', updatePaymentStatus);

// Share an invoice
router.post('/api/invoices/:invoiceId/share', shareInvoice);

// Share an invoice as PDF
router.post('/api/invoices/:invoiceId/share/pdf', shareInvoice);

// Delete an invoice
router.delete('/api/invoices/:invoiceId', deleteInvoice);

// Get invoice statistics
router.get(
  '/api/invoices/stats/:organizationId',
  authenticateUser,
  requireAdmin,
  requireOrganizationMatch('organizationId'),
  getInvoiceStats
);

module.exports = router;
