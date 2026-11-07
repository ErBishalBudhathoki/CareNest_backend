const express = require('express');
const router = express.Router();
const invoiceAIController = require('../controllers/invoiceAIController');
const { authenticateUser } = require('../middleware/auth');
const { requireOrgMembership } = require('../middleware/requireOrgMembership');
const {
  requireMatchingOrganization,
  requireAdminSurface,
} = require('../middleware/adminSurface');

// Invoice AI generates invoices and reads historical pricing/client data for
// an organisation. The global API security gate supplies bearer auth, but it
// does not enforce roles: without these router-level guards any authenticated
// employee or client token could generate another tenant's invoices. The
// organisation is pinned to the validated membership context before the
// controller reads it from the body.
router.use(authenticateUser);
router.use(requireOrgMembership);
router.use(requireMatchingOrganization);
router.use(requireAdminSurface);

// Invoice AI Routes
router.post('/validate', invoiceAIController.validateInvoice);
router.post('/detect-anomalies', invoiceAIController.detectAnomalies);
router.get('/payment-prediction/:invoiceId', invoiceAIController.predictPayment);
router.post('/auto-generate', invoiceAIController.autoGenerateInvoices);
router.post('/generate-from-text', invoiceAIController.generateFromText);
router.get('/smart-reminders/:invoiceId', invoiceAIController.getSmartReminders);

module.exports = router;
