const express = require('express');
const router = express.Router();
const invoiceAIController = require('../controllers/invoiceAIController');

// Invoice AI Routes
router.post('/validate', invoiceAIController.validateInvoice);
router.post('/detect-anomalies', invoiceAIController.detectAnomalies);
router.get('/payment-prediction/:invoiceId', invoiceAIController.predictPayment);
router.post('/auto-generate', invoiceAIController.autoGenerateInvoices);
router.get('/smart-reminders/:invoiceId', invoiceAIController.getSmartReminders);

module.exports = router;
