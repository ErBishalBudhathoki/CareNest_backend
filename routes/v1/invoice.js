const express = require('express');
const router = express.Router();
const invoiceController = require('../../controllers/v1/invoiceController');

// Invoice Generation
router.post('/generate-line-items', invoiceController.generateInvoiceLineItems);
router.get('/preview/:userEmail/:clientEmail', invoiceController.getInvoicePreview);
router.get('/available-assignments/:userEmail', invoiceController.getAvailableAssignments);
router.post('/validate-generation-data', invoiceController.validateInvoiceGenerationData);
router.post('/bulk-generate', invoiceController.generateBulkInvoices);
router.post('/validate-line-items', invoiceController.validateExistingInvoiceLineItems);
router.post('/validate-pricing-realtime', invoiceController.validatePricingRealtime);
router.post('/validation-report', invoiceController.getInvoiceValidationReport);

module.exports = router;
