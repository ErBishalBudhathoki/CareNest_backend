const crypto = require('crypto');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const paymentService = require('../services/paymentService');
const billingNotificationService = require('../services/billing/billingNotificationService');
const { Invoice } = require('../models/Invoice');
const ndisCatalogSyncService = require('../services/ndisCatalogSyncService');
const HostedCheckoutGrant = require('../models/billing/HostedCheckoutGrant');
const Organization = require('../models/Organization');
const recurringAgreementService = require('../services/billing/recurringAgreementService');

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
      case 'checkout.session.completed': {
        const session = event.data.object;
        await this.handleCheckoutSessionCompleted(session);
        break;
      }
      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object;
        await this.handleSetupIntentSucceeded(setupIntent);
        break;
      }
      case 'account.updated': {
        const account = event.data.object;
        await this.handleConnectAccountUpdated(account);
        break;
      }
      case 'charge.dispute.created': {
        await this.handleDisputeOpened(event.data.object, event.account);
        break;
      }
      case 'charge.dispute.closed': {
        await this.handleDisputeClosed(event.data.object, event.account);
        break;
      }
      case 'payout.paid': {
        await this.handlePayoutEvent(event.data.object, 'paid', event.account);
        break;
      }
      case 'payout.failed': {
        await this.handlePayoutEvent(event.data.object, 'failed', event.account);
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

  handlePaymentSuccess = async (paymentIntent) => {
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
  };

  /**
   * Consume a hosted-checkout grant when Stripe confirms the session
   * completed. The session metadata carries the grant id; we do not trust
   * query params or client-side success URLs.
   */
  handleCheckoutSessionCompleted = async (session) => {
    const hostedGrantId = session.metadata?.hostedGrantId;
    if (!hostedGrantId) return;
    await HostedCheckoutGrant.updateOne(
      { _id: hostedGrantId, status: 'active' },
      {
        $set: {
          status: 'consumed',
          consumedAt: new Date(),
        },
      }
    );
    logger.business('Hosted checkout grant consumed', {
      action: 'HOSTED_CHECKOUT_CONSUMED',
      hostedGrantId,
    });
  };

  /**
   * Activate a recurring invoice agreement once Stripe confirms the
   * client has completed the setup-mode consent flow.
   */
  handleSetupIntentSucceeded = async (setupIntent) => {
    const metadata = setupIntent.metadata || {};
    const organizationId = metadata.organizationId;
    const agreementId = metadata.agreementId;
    if (!organizationId || !agreementId) return;
    await recurringAgreementService.activateFromSetup({
      organizationId,
      agreementId,
      paymentMethodId: setupIntent.payment_method,
      customerId: setupIntent.customer,
    });
    logger.business('Recurring agreement activated', {
      action: 'RECURRING_AGREEMENT_ACTIVATED',
      organizationId,
      agreementId,
    });
  };

  /**
   * Update the cached organization status when Stripe reports a
   * connected account change (onboarding completion, capability
   * revocation, etc).
   */
  handleConnectAccountUpdated = async (account) => {
    if (!account?.id) return;
    const org = await Organization.findOne({ stripeAccountId: account.id });
    if (!org) return;
    await Organization.updateOne(
      { _id: org._id },
      {
        $set: {
          'subscription.chargesEnabled': account.charges_enabled === true,
          'subscription.detailsSubmitted': account.details_submitted === true,
          'subscription.payoutsEnabled': account.payouts_enabled === true,
        },
      }
    );
    logger.business('Connected account status updated', {
      action: 'CONNECT_ACCOUNT_UPDATED',
      organizationId: String(org._id),
      chargesEnabled: account.charges_enabled === true,
    });
  };

  /**
   * Resolve the organisation owning a connected-account webhook event.
   * Events from connected accounts carry `event.account` (the acct_... id).
   * Returns null when the account is not linked to any organisation —
   * such events are logged and ignored, never fanned out.
   */
  _findOrgByStripeAccount = async (stripeAccountId) => {
    if (!stripeAccountId) return null;
    return Organization.findOne({ stripeAccountId }).lean();
  };

  _unixToDateString = (unixSeconds) => {
    if (!unixSeconds) return null;
    try {
      return new Date(Number(unixSeconds) * 1000).toLocaleDateString('en-AU');
    } catch {
      return null;
    }
  };

  /**
   * charge.dispute.created — a payer's bank reversed a charge. Resolve the
   * invoice via the PaymentIntent metadata our services always attach, then
   * alert the organisation's billing staff (high priority).
   */
  handleDisputeOpened = async (dispute, connectedAccountId) => {
    try {
      const org = await this._findOrgByStripeAccount(connectedAccountId);
      if (!org) {
        logger.business('Dispute for unlinked Stripe account ignored', {
          action: 'DISPUTE_UNLINKED_ACCOUNT',
          stripeAccountId: connectedAccountId,
        });
        return;
      }
      let invoiceId = dispute?.metadata?.invoice_id || null;
      if (!invoiceId && dispute?.payment_intent && stripe) {
        const piId =
          typeof dispute.payment_intent === 'string'
            ? dispute.payment_intent
            : dispute.payment_intent.id;
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(piId, {
            stripeAccount: connectedAccountId,
          });
          // Only trust the invoice id when the intent belongs to this org.
          const metaInvoiceId = paymentIntent?.metadata?.invoiceId || null;
          const metaOrgId = paymentIntent?.metadata?.organizationId || null;
          if (metaInvoiceId && (!metaOrgId || metaOrgId === String(org._id))) {
            invoiceId = metaInvoiceId;
          }
        } catch (retrieveError) {
          logger.warn('Could not retrieve disputed payment intent', {
            paymentIntentId: piId,
            error: retrieveError.message,
          });
        }
      }
      const invoice = invoiceId
        ? await Invoice.findById(invoiceId).lean()
        : null;
      await billingNotificationService.notifyStripeDisputeOpened({
        organizationId: org._id,
        invoiceId: invoice?._id || invoiceId,
        invoiceNumber: invoice?.invoiceNumber,
        amount: (Number(dispute?.amount) || 0) / 100,
        reason: dispute?.reason || null,
        dueBy: this._unixToDateString(dispute?.evidence_details?.due_by),
      });
      logger.business('Stripe dispute opened notification sent', {
        action: 'DISPUTE_OPENED',
        organizationId: String(org._id),
        disputeId: dispute?.id,
      });
    } catch (error) {
      logger.warn('Failed to handle dispute.created webhook', {
        error: error.message,
        disputeId: dispute?.id,
      });
    }
  };

  /**
   * charge.dispute.closed — inform billing staff of the outcome.
   */
  handleDisputeClosed = async (dispute, connectedAccountId) => {
    try {
      const org = await this._findOrgByStripeAccount(connectedAccountId);
      if (!org) return;
      const won = dispute?.status === 'won';
      await billingNotificationService.fanOut({
        organizationId: org._id,
        kind: 'stripe_dispute_closed',
        title: won ? 'Dispute won' : 'Dispute lost',
        message: won
          ? `The ${((Number(dispute?.amount) || 0) / 100).toFixed(2)} dispute was decided in your favour.`
          : `The ${((Number(dispute?.amount) || 0) / 100).toFixed(2)} dispute was lost. The amount stays with the payer.`,
        priority: won ? 'medium' : 'high',
      });
    } catch (error) {
      logger.warn('Failed to handle dispute.closed webhook', {
        error: error.message,
        disputeId: dispute?.id,
      });
    }
  };

  /**
   * payout.paid / payout.failed — keep billing staff aware of money movement.
   */
  handlePayoutEvent = async (payout, status, connectedAccountId) => {
    try {
      const org = await this._findOrgByStripeAccount(connectedAccountId);
      if (!org) {
        logger.business('Payout for unlinked Stripe account ignored', {
          action: 'PAYOUT_UNLINKED_ACCOUNT',
          stripeAccountId: connectedAccountId,
        });
        return;
      }
      await billingNotificationService.notifyPayout({
        organizationId: org._id,
        amount: (Number(payout?.amount) || 0) / 100,
        arrivalDate: this._unixToDateString(payout?.arrival_date),
        status,
        failureMessage: payout?.failure_message || payout?.failure_code || null,
      });
    } catch (error) {
      logger.warn('Failed to handle payout webhook', {
        error: error.message,
        payoutId: payout?.id,
        status,
      });
    }
  };

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
