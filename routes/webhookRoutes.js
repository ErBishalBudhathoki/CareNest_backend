const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Stripe requires the raw body for signature verification
router.post('/stripe', express.raw({ type: 'application/json' }), (req, res) => webhookController.handleStripeWebhook(req, res));

module.exports = router;
