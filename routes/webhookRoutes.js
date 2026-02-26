const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const webhookController = require('../controllers/webhookController');

// Rate limiting for webhooks (important for security)
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many webhook requests.' }
});

// Stripe requires the raw body for signature verification
router.post('/stripe', webhookLimiter, express.raw({ type: 'application/json' }), (req, res) => webhookController.handleStripeWebhook(req, res));

// NDIS catalog updates from object storage (R2 worker / GCS PubSub push relay)
router.post('/ndis-catalog', webhookLimiter, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => webhookController.handleNdisCatalogWebhook(req, res));

module.exports = router;
