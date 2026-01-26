const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateUser } = require('../middleware/auth');

// Payment Routes
router.post('/create-intent', authenticateUser, paymentController.createPaymentIntent);
router.post('/onboarding-link', authenticateUser, paymentController.createOnboardingLink);
router.post('/record', authenticateUser, paymentController.recordPayment);

// Credit Note Routes
router.post('/credit-note', authenticateUser, paymentController.createCreditNote);
router.post('/credit-note/apply', authenticateUser, paymentController.applyCreditNote);
router.post('/refund', authenticateUser, paymentController.refundPayment);

module.exports = router;
