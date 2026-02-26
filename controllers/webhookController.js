const crypto = require('crypto');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const paymentService = require('../services/paymentService');
const ndisCatalogSyncService = require('../services/ndisCatalogSyncService');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

class WebhookController {
  _safeEquals(a, b) {
    if (!a || !b) return false;
    const left = Buffer.from(String(a), 'utf8');
    const right = Buffer.from(String(b), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  _normalizeKey(value) {
    return String(value || '')
      .replace(/^\/+/, '')
      .trim();
  }

  _getRawPayload(req) {
    if (Buffer.isBuffer(req.body)) {
      return req.body.toString('utf8');
    }
    if (Buffer.isBuffer(req.rawBody)) {
      return req.rawBody.toString('utf8');
    }
    if (typeof req.body === 'string') {
      return req.body;
    }
    if (req.body && typeof req.body === 'object') {
      return JSON.stringify(req.body);
    }
    return '';
  }

  _parsePayload(req, rawPayload) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body;
    }
    if (!rawPayload) return {};
    try {
      return JSON.parse(rawPayload);
    } catch {
      return {};
    }
  }

  _isWebhookAuthorized(req, rawPayload) {
    const sharedToken = process.env.NDIS_CATALOG_WEBHOOK_TOKEN;
    const signingSecret = process.env.NDIS_CATALOG_WEBHOOK_SECRET;
    const headerToken =
      req.get('x-ndis-webhook-token') || req.get('x-webhook-token');
    const queryToken = req.query?.token;
    const authorization = req.get('authorization') || '';
    const bearerToken = authorization.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : null;

    if (
      sharedToken &&
      (this._safeEquals(headerToken, sharedToken) ||
        this._safeEquals(queryToken, sharedToken) ||
        this._safeEquals(bearerToken, sharedToken))
    ) {
      return true;
    }

    const signatureHeader =
      req.get('x-ndis-signature') || req.get('x-signature');
    if (signingSecret && signatureHeader) {
      const provided = String(signatureHeader).replace(/^sha256=/i, '').trim();
      const expected = crypto
        .createHmac('sha256', signingSecret)
        .update(rawPayload)
        .digest('hex');
      if (this._safeEquals(provided, expected)) {
        return true;
      }
    }

    // Convenience for local development if no webhook auth is configured.
    if (!sharedToken && !signingSecret && process.env.NODE_ENV !== 'production') {
      return true;
    }

    return false;
  }

  _extractStorageEvents(payload) {
    const events = [];
    const pushEvent = (bucket, key, eventType, source) => {
      if (!key) return;
      events.push({
        bucket: bucket ? String(bucket).trim() : null,
        key: this._normalizeKey(key),
        eventType: eventType ? String(eventType).trim() : null,
        source,
      });
    };

    // Generic direct payload
    pushEvent(
      payload.bucket || payload.bucketName || payload.bucketId,
      payload.key ||
        payload.objectKey ||
        payload.name ||
        payload.objectId ||
        payload.object?.key ||
        payload.object?.name,
      payload.eventType || payload.type || payload.action,
      'direct',
    );

    // AWS/R2 style notifications
    const records = payload.Records || payload.records;
    if (Array.isArray(records)) {
      for (const record of records) {
        pushEvent(
          record?.s3?.bucket?.name || record?.bucket?.name,
          record?.s3?.object?.key || record?.object?.key,
          record?.eventName || record?.eventType,
          'records',
        );
      }
    }

    // GCS Pub/Sub push envelope
    if (payload.message) {
      const attrs = payload.message.attributes || {};
      let decoded = {};
      if (typeof payload.message.data === 'string') {
        try {
          decoded = JSON.parse(
            Buffer.from(payload.message.data, 'base64').toString('utf8'),
          );
        } catch (_) {}
      }

      pushEvent(
        decoded.bucket ||
          decoded.bucketId ||
          attrs.bucket ||
          attrs.bucketId ||
          payload.subscriptionBucket,
        decoded.name ||
          decoded.objectId ||
          decoded.key ||
          attrs.objectId ||
          attrs.name ||
          attrs.key,
        decoded.eventType || attrs.eventType,
        'gcs_pubsub',
      );
    }

    return events;
  }

  _isRelevantStorageEvent(event, target) {
    if (!event?.key) return false;
    if (target.bucket && event.bucket && target.bucket !== event.bucket) {
      return false;
    }

    if (event.key === target.key) {
      return true;
    }

    if (target.watchPrefix && event.key.startsWith(target.watchPrefix)) {
      return true;
    }

    return false;
  }

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

  handleNdisCatalogWebhook = catchAsync(async (req, res) => {
    const rawPayload = this._getRawPayload(req);
    if (!this._isWebhookAuthorized(req, rawPayload)) {
      logger.warn('NDIS catalog webhook unauthorized request');
      return res.status(403).json({
        success: false,
        code: 'WEBHOOK_UNAUTHORIZED',
        message: 'Unauthorized webhook request',
      });
    }

    const payload = this._parsePayload(req, rawPayload);
    const events = this._extractStorageEvents(payload);
    const target = ndisCatalogSyncService.getCatalogTarget();
    const relevantEvents = events.filter((event) =>
      this._isRelevantStorageEvent(event, target),
    );

    // If there are events but none match the configured target, acknowledge and skip.
    if (events.length > 0 && relevantEvents.length === 0) {
      return res.status(202).json({
        success: true,
        skipped: true,
        message: 'Webhook received but no relevant NDIS catalog change found',
        seenEvents: events.length,
      });
    }

    const force = req.query.force === 'true';
    const selectedEvent = relevantEvents[0];
    const syncResult = await ndisCatalogSyncService.syncIfChanged({
      force,
      reason: selectedEvent ? 'storage_webhook_event' : 'storage_webhook_manual',
      objectKey: selectedEvent?.key,
      bucket: selectedEvent?.bucket || target.bucket,
    });

    return res.status(200).json({
      success: true,
      message: syncResult.skipped
        ? 'NDIS catalog unchanged'
        : 'NDIS catalog synchronized',
      sourceEvent: selectedEvent || null,
      result: syncResult,
    });
  });
}

module.exports = new WebhookController();
