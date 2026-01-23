const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middleware/auth');

// Payment Routes
router.post('/create-intent', verifyToken, paymentController.createPaymentIntent);
router.post('/record', verifyToken, paymentController.recordPayment);

// Credit Note Routes
router.post('/credit-note', verifyToken, paymentController.createCreditNote);
router.post('/credit-note/apply', verifyToken, paymentController.applyCreditNote);

module.exports = router;
