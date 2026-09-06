const Entitlement = require('../../models/billing/Entitlement');
const Organization = require('../../models/Organization');
const appleVerifier = require('./appleReceiptVerifier');
const googleVerifier = require('./googlePlayReceiptVerifier');
const logger = require('../../config/logger');

const RECONCILE_GRACE_DAYS = 3;

/**
 * Convert a verified store payload into a stored Entitlement, then refresh
 * the cached organization status so the access gate can decide
 * without trusting the mobile client.
 */
async function persistEntitlement(organizationId, verified) {
  const now = new Date();
  const startsAt = new Date(verified.raw?.purchaseDate ? Number(verified.raw.purchaseDate) : now.getTime());
  const graceEndsAt = new Date(verified.expiresAt.getTime() + RECONCILE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const status = verified.isRevoked
    ? 'revoked'
    : verified.isInBillingRetry
    ? 'billing_retry'
    : 'active';

  const entitlement = await Entitlement.findOneAndUpdate(
    { source: verified.source, storeIdentifier: verified.storeIdentifier },
    {
      $set: {
        organizationId,
        source: verified.source,
        productId: verified.productId,
        storeIdentifier: verified.storeIdentifier,
        status,
        environment: verified.environment,
        startsAt,
        expiresAt: verified.expiresAt,
        graceEndsAt,
        lastReceiptPayload: verified.raw,
        lastVerifiedAt: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Organization.updateOne(
    { _id: organizationId },
    {
      $set: {
        'subscription.entitlementId': entitlement._id,
        'subscription.lastVerifiedAt': now,
      },
    }
  );
  return entitlement;
}

async function refreshOrganizationStatus(organizationId) {
  const active = await Entitlement.findOne({
    organizationId,
    status: { $in: ['active', 'billing_retry'] },
    expiresAt: { $gt: new Date() },
  })
    .sort({ expiresAt: -1 })
    .lean();

  if (active) {
    await Organization.updateOne(
      { _id: organizationId },
      {
        $set: {
          'subscription.entitlementId': active._id,
          'subscription.status': 'active',
          'subscription.expiresAt': active.expiresAt,
          'subscription.graceEndsAt': active.graceEndsAt,
          'subscription.source': active.source,
        },
      }
    );
    return { status: 'active', expiresAt: active.expiresAt };
  }

  const grace = await Entitlement.findOne({
    organizationId,
    status: { $in: ['active', 'billing_retry'] },
    graceEndsAt: { $gt: new Date() },
  })
    .sort({ graceEndsAt: -1 })
    .lean();

  if (grace) {
    await Organization.updateOne(
      { _id: organizationId },
      {
        $set: {
          'subscription.entitlementId': grace._id,
          'subscription.status': 'grace',
          'subscription.expiresAt': grace.expiresAt,
          'subscription.graceEndsAt': grace.graceEndsAt,
        },
      }
    );
    return { status: 'grace', expiresAt: grace.expiresAt };
  }

  await Organization.updateOne(
    { _id: organizationId },
    {
      $set: {
        'subscription.status': 'expired',
      },
    }
  );
  return { status: 'expired' };
}

const entitlementService = {
  async verifyApple({ organizationId, transactionJws, productId }) {
    const verified = await appleVerifier.verify({ transactionJws, productId });
    const entitlement = await persistEntitlement(organizationId, verified);
    const status = await refreshOrganizationStatus(organizationId);
    logger.info('Apple entitlement verified', {
      organizationId,
      productId: verified.productId,
      status: status.status,
    });
    return { entitlement, status };
  },

  async verifyGoogle({ organizationId, purchaseToken, productId, subscriptionId }) {
    const verified = await googleVerifier.verify({
      purchaseToken,
      productId,
      subscriptionId,
    });
    const entitlement = await persistEntitlement(organizationId, verified);
    const status = await refreshOrganizationStatus(organizationId);
    logger.info('Google entitlement verified', {
      organizationId,
      productId: verified.productId,
      status: status.status,
    });
    return { entitlement, status };
  },

  refreshOrganizationStatus,
  appleConfigured: () => appleVerifier.isConfigured(),
  googleConfigured: () => googleVerifier.isConfigured(),
};

module.exports = entitlementService;
