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

/**
 * Stripe Connect onboarding return/refresh landing page. Registered as the
 * STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL so the user sees a
 * friendly confirmation instead of a bare backend root.
 */
router.get('/return', publicLimiter, (req, res) => {
  res.status(200).type('html').send(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>CareNest &middot; Stripe setup</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
               background: #F7F5F0; color: #1A1A1A; margin: 0; padding: 40px 20px;
               display: flex; align-items: center; justify-content: center; min-height: 80vh; }
        .card { background: #FFFFFF; border: 2px solid #1A1A1A; box-shadow: 8px 8px 0 #1A1A1A;
                max-width: 420px; width: 100%; padding: 28px; }
        h1 { font-size: 20px; margin: 0 0 12px; letter-spacing: 1px; }
        p { font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
        .ok { color: #0DA85E; font-weight: 700; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>STRIPE SETUP</h1>
        <p class="ok">Your Stripe account has been submitted.</p>
        <p>You can close this window and return to the CareNest app. It may take a
           moment for the connection status to refresh.</p>
      </div>
    </body>
  </html>`);
});

module.exports = router;
