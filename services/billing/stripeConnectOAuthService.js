const crypto = require('crypto');
const OAuthState = require('../../models/billing/OAuthState');
const Organization = require('../../models/Organization');
const logger = require('../../config/logger');

const STATE_TTL_MS = 10 * 60 * 1000;

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function isAllowlistedRedirect(uri) {
  if (typeof uri !== 'string' || typeof process.env.STRIPE_CONNECT_REDIRECT_URI !== 'string') {
    return false;
  }
  try {
    const candidate = new URL(uri);
    const allowed = new URL(process.env.STRIPE_CONNECT_REDIRECT_URI);
    return (
      candidate.protocol === allowed.protocol &&
      candidate.host === allowed.host
    );
  } catch {
    return false;
  }
}

async function createAuthorizationUrl({ organizationId, userId }) {
  if (!stripe) throw new Error('Stripe is not configured on the server');
  if (!isAllowlistedRedirect(process.env.STRIPE_CONNECT_REDIRECT_URI)) {
    throw new Error('STRIPE_CONNECT_REDIRECT_URI must be a valid HTTPS URL');
  }
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) {
    throw new Error('STRIPE_CONNECT_CLIENT_ID is not configured');
  }
  const state = crypto.randomBytes(32).toString('base64url');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await OAuthState.create({
    stateHash,
    organizationId,
    initiatingUserId: userId,
    purpose: 'stripe_connect_existing_account',
    expiresAt,
  });

  const url = new URL('https://connect.stripe.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'read_write');
  url.searchParams.set('redirect_uri', process.env.STRIPE_CONNECT_REDIRECT_URI);
  url.searchParams.set('state', state);

  return { url: url.toString() };
}

async function consumeStateAndExchange({ code, state, organizationId }) {
  if (!stripe) throw new Error('Stripe is not configured on the server');
  if (typeof code !== 'string' || typeof state !== 'string') {
    throw new Error('Missing OAuth code or state');
  }
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const stateDoc = await OAuthState.findOne({ stateHash });
  if (!stateDoc || stateDoc.consumedAt) {
    throw new Error('Invalid or already-used OAuth state');
  }
  if (String(stateDoc.organizationId) !== String(organizationId)) {
    throw new Error('OAuth state does not match the requesting organization');
  }
  // Note: the callback is a public browser redirect with no bearer auth.
  // Authorization is carried by the single-use 32-byte state token bound
  // to the organization and initiating user at start time.
  if (stateDoc.expiresAt.getTime() < Date.now()) {
    await OAuthState.deleteOne({ _id: stateDoc._id });
    throw new Error('OAuth state has expired');
  }

  stateDoc.consumedAt = new Date();
  await stateDoc.save();

  const response = await stripe.oauth.token({
    grant_type: 'authorization_code',
    code,
  });

  if (!response.stripe_user_id) {
    throw new Error('Stripe did not return a connected account identifier');
  }

  const account = await stripe.accounts.retrieve(response.stripe_user_id);
  if (account.charges_enabled === false || account.details_submitted === false) {
    logger.warn('Linked Stripe account is not fully onboarded', {
      stripeAccountId: account.id,
    });
  }

  await Organization.updateOne(
    { _id: organizationId },
    {
      $set: {
        stripeAccountId: account.id,
        'subscription.connectedAt': new Date(),
        'subscription.connectedAccountSource': 'oauth',
      },
    }
  );

  return {
    stripeAccountId: account.id,
    detailsSubmitted: account.details_submitted === true,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
  };
}

module.exports = {
  createAuthorizationUrl,
  consumeStateAndExchange,
};
