const express = require('express');
const router = express.Router();
const stripeConnectOAuthController = require('../../controllers/billing/stripeConnectOAuthController');
const rateLimit = require('express-rate-limit');

const publicLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many requests.' },
});

router.get('/callback', publicLimiter, stripeConnectOAuthController.callback);

module.exports = router;
