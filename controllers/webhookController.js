const paymentService = require('../services/paymentService');
// const { Invoice } = require('../models/Invoice'); // Unused
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

class WebhookController {
  async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe || !webhookSecret) {
      console.warn('Stripe or Webhook Secret not configured');
      return res.status(400).send('Webhook Error: Configuration missing');
    }

    let event;

    try {
      // Use raw body if available (Express needs raw body for signature verification)
      // Assuming body-parser or similar middleware has been configured to provide rawBody
      // or we might need to adjust how we read the body.
      // For now, assuming standard express setup where req.body might be parsed JSON
      // If express.json() is used globally, this might fail verification.
      // We usually need `express.raw({type: 'application/json'})` for this route.
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error(`Webhook signature verification failed.`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    try {
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object;
          await this.handlePaymentSuccess(paymentIntent);
          break;
        }
        // ... handle other event types
        default:
          console.log(`Unhandled event type ${event.type}`);
      }
      res.json({received: true});
    } catch (err) {
      console.error('Error processing webhook event:', err);
      res.status(500).send('Internal Server Error');
    }
  }

  async handlePaymentSuccess(paymentIntent) {
    const { invoiceId } = paymentIntent.metadata;
    if (!invoiceId) {
      console.warn('Invoice ID missing in payment intent metadata');
      return;
    }

    const amount = paymentIntent.amount_received / 100; // Convert cents to dollars
    
    // Use paymentService to record the payment
    // We use 'Stripe Webhook' as the userEmail for audit logs
    await paymentService.recordPayment(invoiceId, {
      amount: amount,
      method: 'stripe',
      reference: paymentIntent.id,
      notes: 'Payment confirmed via Stripe Webhook'
    }, 'Stripe Webhook');
    
    console.log(`Successfully recorded payment for invoice ${invoiceId}`);
  }
}

module.exports = new WebhookController();
