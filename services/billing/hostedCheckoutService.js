const crypto = require('crypto');
const HostedCheckoutGrant = require('../../models/billing/HostedCheckoutGrant');
const { Invoice } = require('../../models/Invoice');
const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

let stripe;
function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY || (process.env.NODE_ENV === 'test' ? 'sk_test_mock' : null);
  if (key) {
    stripe = require('stripe')(key);
    return stripe;
  }
  return null;
}

/**
 * Public hosted invoice checkout.
 *
 * Flow:
 *   1. Organization member requests a grant for an invoice they own.
 *   2. Server computes the payable amount from the invoice, verifies the
 *      organization has a Stripe Connect account that can charge, and
 *      creates a single-use grant bound to (invoice, amount, currency,
 *      connected account).
 *   3. The grant's plain token is returned to the app, which sends it to
 *      the client (email, SMS, PDF). The plain token is never stored.
 *   4. The public endpoint exchanges the plain token for a Stripe
 *      Checkout Session URL scoped to the connected account.
 */
async function createGrant({ organizationId, invoiceId, createdBy, ttlMinutes = 60 * 24 }) {
  const stripeClient = getStripe();
  if (!stripeClient) {
    throw new Error('Stripe is not configured on the server');
  }
  const [invoice, org] = await Promise.all([
    Invoice.findOne({ _id: invoiceId, organizationId }),
    Organization.findById(organizationId),
  ]);
  if (!invoice) throw new Error('Invoice not found');
  if (!org?.stripeAccountId) {
    throw new Error('Organization must complete Stripe Connect onboarding');
  }
  const account = await stripeClient.accounts.retrieve(org.stripeAccountId);
  if (!account.details_submitted || !account.charges_enabled) {
    throw new Error('Organization must complete Stripe Connect onboarding');
  }

  const totalAmount = Number(invoice.financialSummary?.totalAmount || 0);
  const paidAmount = Number(invoice.payment?.paidAmount || 0);
  const balanceDueCents = Math.round(Math.max(0, totalAmount - paidAmount) * 100);
  if (balanceDueCents <= 0) {
    throw new Error('Invoice has no payable balance');
  }
  const currency = String(invoice.financialSummary?.currency || 'AUD').toUpperCase();

  const plainToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const grant = await HostedCheckoutGrant.create({
    organizationId,
    invoiceId,
    tokenHash,
    amountCents: balanceDueCents,
    currency,
    stripeAccountId: org.stripeAccountId,
    expiresAt,
    createdBy,
  });

  return { grant, plainToken };
}

async function resolveGrant(plainToken) {
  const tokenHash = crypto.createHash('sha256').update(String(plainToken || '')).digest('hex');
  const grant = await HostedCheckoutGrant.findOne({ tokenHash });
  if (!grant) return { error: 'NOT_FOUND' };
  if (grant.status !== 'active') return { error: 'INACTIVE' };
  if (grant.expiresAt.getTime() < Date.now()) {
    await HostedCheckoutGrant.updateOne(
      { _id: grant._id },
      { $set: { status: 'expired' } }
    );
    return { error: 'EXPIRED' };
  }
  return { grant };
}

async function createCheckoutSession({ plainToken, successUrl, cancelUrl }) {
  const stripeClient = getStripe();
  if (!stripeClient) {
    throw new Error('Stripe is not configured on the server');
  }
  const { grant, error } = await resolveGrant(plainToken);
  if (error === 'NOT_FOUND') {
    const err = new Error('Invalid payment link');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  if (error === 'INACTIVE' || error === 'EXPIRED') {
    const err = new Error('Payment link is no longer active');
    err.code = 'INACTIVE_TOKEN';
    throw err;
  }

  const successUrlValid = isAllowedUrl(successUrl, process.env.PAYMENT_PUBLIC_RETURN_URL);
  const cancelUrlValid = isAllowedUrl(cancelUrl, process.env.PAYMENT_PUBLIC_CANCEL_URL);
  if (!successUrlValid || !cancelUrlValid) {
    const err = new Error('Return URLs are not in the allowlist');
    err.code = 'INVALID_RETURN_URL';
    throw err;
  }

  const session = await stripeClient.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: grant.currency.toLowerCase(),
            unit_amount: grant.amountCents,
            product_data: {
              name: 'CareNest invoice payment',
              metadata: { invoiceId: String(grant.invoiceId) },
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organizationId: String(grant.organizationId),
        invoiceId: String(grant.invoiceId),
        hostedGrantId: String(grant._id),
      },
      payment_intent_data: {
        metadata: {
          organizationId: String(grant.organizationId),
          invoiceId: String(grant.invoiceId),
          hostedGrantId: String(grant._id),
        },
      },
    },
    { stripeAccount: grant.stripeAccountId }
  );

  await HostedCheckoutGrant.updateOne(
    { _id: grant._id },
    {
      $set: {
        stripeCheckoutSessionId: session.id,
        lastAccessedAt: new Date(),
      },
    }
  );

  return { url: session.url, sessionId: session.id };
}

async function consumeGrant(grantId) {
  await HostedCheckoutGrant.updateOne(
    { _id: grantId, status: 'active' },
    {
      $set: {
        status: 'consumed',
        consumedAt: new Date(),
      },
    }
  );
}

function isAllowedUrl(candidate, configuredAllowlist) {
  if (typeof candidate !== 'string' || typeof configuredAllowlist !== 'string') {
    return false;
  }
  try {
    const candidateUrl = new URL(candidate);
    if (candidateUrl.protocol !== 'https:') return false;
    const allowedHosts = configuredAllowlist
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).host);
    return allowedHosts.includes(candidateUrl.host);
  } catch {
    return false;
  }
}

module.exports = {
  createGrant,
  createCheckoutSession,
  resolveGrant,
  consumeGrant,
};
