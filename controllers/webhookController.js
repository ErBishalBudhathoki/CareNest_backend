const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const paymentService = require('../services/paymentService');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

class WebhookController {
  handleStripeWebhook = catchAsync(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe || !webhookSecret) {
      logger.business('Stripe webhook configuration missing', {
        action: 'WEBHOOK_CONFIG_MISSING',
        hasStripe: !!stripe,
        hasWebhookSecret: !!webhookSecret
      });
      return res.status(400).json({
        success: false,
        code: 'CONFIGURATION_ERROR',
        message: 'Webhook Error: Configuration missing'
      });
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      logger.business('Webhook signature verification failed', {
        action: 'WEBHOOK_VERIFICATION_FAILED',
        error: err.message
      });
      return res.status(400).json({
        success: false,
        code: 'VERIFICATION_ERROR',
        message: `Webhook Error: ${err.message}`
      });
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        await this.handlePaymentSuccess(paymentIntent);
        break;
      }
      default:
        logger.business('Unhandled webhook event type', {
          action: 'UNHANDLED_WEBHOOK_EVENT',
          eventType: event.type
        });
    }

    logger.business('Stripe webhook processed', {
      action: 'WEBHOOK_PROCESSED',
      eventType: event.type,
      eventId: event.id
    });

    res.status(200).json({
      success: true,
      code: 'WEBHOOK_RECEIVED',
      received: true
    });
  });

  handlePaymentSuccess = catchAsync(async (paymentIntent) => {
    const { invoiceId } = paymentIntent.metadata;

    if (!invoiceId) {
      logger.business('Payment intent missing invoice ID', {
        action: 'PAYMENT_MISSING_INVOICE_ID',
        paymentIntentId: paymentIntent.id
      });
      return;
    }

    const amount = paymentIntent.amount_received / 100; // Convert cents to dollars

    // Use paymentService to record the payment
    await paymentService.recordPayment(invoiceId, {
      amount: amount,
      method: 'stripe',
      reference: paymentIntent.id,
      notes: 'Payment confirmed via Stripe Webhook'
    }, 'Stripe Webhook');

    logger.business('Payment recorded via webhook', {
      action: 'PAYMENT_RECORDED_WEBHOOK',
      invoiceId,
      paymentIntentId: paymentIntent.id,
      amount
    });
  });
}

module.exports = new WebhookController();
