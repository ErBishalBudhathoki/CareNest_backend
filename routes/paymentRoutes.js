const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middleware/auth');

// Payment Routes
router.post('/create-intent', verifyToken, (req, res) => paymentController.createPaymentIntent(req, res));
router.post('/record', verifyToken, (req, res) => paymentController.recordPayment(req, res));

// Credit Note Routes
router.post('/credit-note', verifyToken, (req, res) => paymentController.createCreditNote(req, res));
router.post('/credit-note/apply', verifyToken, (req, res) => paymentController.applyCreditNote(req, res));

module.exports = router;
