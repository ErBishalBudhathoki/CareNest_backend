const Invoice = require('../../models/Invoice');
const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

/**
 * Creates and manages Stripe Payment Links for invoices.
 *
 * A Payment Link is created automatically when an invoice is generated, on the
 * organization's connected account (direct charge, no platform fee). The link
 * is a bearer URL whose amount is the remaining balance due. It is deactivated
 * once the invoice is paid in full so the URL cannot be charged twice.
 *
 * Reconciliation is handled by the existing `payment_intent.succeeded` webhook
 * path: we attach `metadata.invoiceId` to both the Payment Link (copied to the
 * Checkout Session) and the underlying PaymentIntent.
 */

let stripe;
function getStripe() {
  if (stripe) return stripe;
  const key =
    process.env.STRIPE_SECRET_KEY ||
    (process.env.NODE_ENV === 'test' ? 'sk_test_mock' : null);
  if (key) {
    stripe = require('stripe')(key);
    return stripe;
  }
  return null;
}

function resolveReturnUrl() {
  const candidate =
    process.env.PAYMENT_LINK_RETURN_URL ||
    process.env.PAYMENT_PUBLIC_RETURN_URL ||
    process.env.FRONTEND_URL ||
    '';
  const first = String(candidate).split(',')[0].trim();
  if (!first) return null;
  try {
    const url = new URL(first);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function balanceDueCents(invoice) {
  const total = Number(invoice?.financialSummary?.totalAmount || 0);
  const paid = Number(invoice?.payment?.paidAmount || 0);
  return Math.round(Math.max(0, total - paid) * 100);
}

async function ensureInvoiceProduct(stripeClient, organization) {
  if (organization.stripeInvoiceProductId) {
    return organization.stripeInvoiceProductId;
  }
  const product = await stripeClient.products.create(
    {
      name: 'CareNest invoice payment',
      metadata: { organizationId: String(organization._id) },
    },
    { stripeAccount: organization.stripeAccountId }
  );
  await Organization.updateOne(
    { _id: organization._id },
    { $set: { stripeInvoiceProductId: product.id } }
  );
  return product.id;
}

async function deactivateStripeLink(paymentLinkId, stripeAccountId) {
  const stripeClient = getStripe();
  if (!stripeClient || !paymentLinkId) return false;
  try {
    await stripeClient.paymentLinks.update(
      paymentLinkId,
      { active: false },
      stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
    );
    return true;
  } catch (error) {
    logger.warn('Failed to deactivate Stripe payment link', {
      paymentLinkId,
      error: error.message,
    });
    return false;
  }
}

/**
 * Best-effort creation of a payment link for an invoice. Returns
 * `{ skipped: true, reason }` when the invoice cannot be paid online yet.
 */
async function createInvoicePaymentLink({ organizationId, invoiceId }) {
  const stripeClient = getStripe();
  if (!stripeClient) {
    return { skipped: true, reason: 'stripe_not_configured' };
  }

  const invoice = await Invoice.findOne({
    _id: invoiceId,
    organizationId,
    'deletion.isDeleted': { $ne: true },
  });
  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const organization = await Organization.findById(organizationId);
  if (!organization?.stripeAccountId) {
    return { skipped: true, reason: 'organization_not_connected' };
  }

  const account = await stripeClient.accounts.retrieve(
    organization.stripeAccountId
  );
  if (!account.charges_enabled || !account.details_submitted) {
    return { skipped: true, reason: 'charges_not_enabled' };
  }

  const amountCents = balanceDueCents(invoice);
  if (amountCents <= 0) {
    return { skipped: true, reason: 'no_balance_due' };
  }

  const currency = String(
    invoice.financialSummary?.currency || 'AUD'
  ).toLowerCase();

  // Reuse a still-valid active link for the same amount.
  if (
    invoice.payment?.paymentLinkId &&
    invoice.payment?.paymentLinkStatus === 'active' &&
    invoice.payment?.paymentLinkAmountCents === amountCents
  ) {
    return {
      url: invoice.payment.paymentLinkUrl,
      paymentLinkId: invoice.payment.paymentLinkId,
      amountCents,
      currency,
      reused: true,
    };
  }

  // Deactivate a stale link before replacing it (e.g. amount changed).
  if (
    invoice.payment?.paymentLinkId &&
    invoice.payment?.paymentLinkStatus === 'active'
  ) {
    await deactivateStripeLink(
      invoice.payment.paymentLinkId,
      invoice.payment.paymentLinkStripeAccountId || organization.stripeAccountId
    );
  }

  const productId = await ensureInvoiceProduct(stripeClient, organization);
  const price = await stripeClient.prices.create(
    {
      currency,
      unit_amount: amountCents,
      product: productId,
      metadata: {
        invoiceId: String(invoice._id),
        organizationId: String(organizationId),
      },
    },
    { stripeAccount: organization.stripeAccountId }
  );

  const metadata = {
    invoiceId: String(invoice._id),
    organizationId: String(organizationId),
  };

  const params = {
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    payment_intent_data: { metadata },
  };

  const returnUrl = resolveReturnUrl();
  if (returnUrl) {
    params.after_completion = {
      type: 'redirect',
      redirect: { url: returnUrl },
    };
  }

  const link = await stripeClient.paymentLinks.create(params, {
    stripeAccount: organization.stripeAccountId,
  });

  invoice.payment = invoice.payment || {};
  invoice.payment.paymentLinkId = link.id;
  invoice.payment.paymentLinkUrl = link.url;
  invoice.payment.paymentLinkStatus = 'active';
  invoice.payment.paymentLinkAmountCents = amountCents;
  invoice.payment.paymentLinkStripeAccountId = organization.stripeAccountId;
  invoice.payment.paymentLinkCreatedAt = new Date();
  await invoice.save();

  logger.info('Invoice payment link created', {
    organizationId,
    invoiceId: String(invoice._id),
    paymentLinkId: link.id,
    amountCents,
    currency,
  });

  return {
    url: link.url,
    paymentLinkId: link.id,
    amountCents,
    currency,
  };
}

/**
 * Returns an active link for an invoice, creating one if missing.
 * Used by the client portal "Pay now" action.
 */
async function ensureInvoicePaymentLink({ organizationId, invoiceId }) {
  return createInvoicePaymentLink({ organizationId, invoiceId });
}

/**
 * Deactivates the Stripe link on an invoice (if any) and records the status.
 * Safe to call multiple times.
 */
async function deactivateInvoicePaymentLink(invoice) {
  if (!invoice?.payment?.paymentLinkId) {
    return { skipped: true, reason: 'no_payment_link' };
  }
  const paymentLinkId = invoice.payment.paymentLinkId;
  const stripeAccountId =
    invoice.payment.paymentLinkStripeAccountId || undefined;

  await deactivateStripeLink(paymentLinkId, stripeAccountId);

  await Invoice.updateOne(
    { _id: invoice._id, 'payment.paymentLinkId': paymentLinkId },
    { $set: { 'payment.paymentLinkStatus': 'deactivated' } }
  );

  return { success: true, paymentLinkId };
}

module.exports = {
  createInvoicePaymentLink,
  ensureInvoicePaymentLink,
  deactivateInvoicePaymentLink,
};
