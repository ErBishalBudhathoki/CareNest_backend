const Entitlement = require('../../models/billing/Entitlement');
const Organization = require('../../models/Organization');
const appleVerifier = require('./appleReceiptVerifier');
const googleVerifier = require('./googlePlayReceiptVerifier');
const logger = require('../../config/logger');

/**
 * Write to the Organization document and drop its cached projection.
 *
 * getOrganizationById() caches the whole organization for 15 minutes, so any
 * write that is not followed by an invalidation will serve the pre-write
 * subscription status for that window. Every `subscription.*` write must go
 * through here.
 *
 * organizationService is required lazily to avoid a circular dependency
 * (organizationService pulls in the billing stack that depends on this file).
 */
async function updateOrganizationSubscription(organizationId, update) {
  await Organization.updateOne({ _id: organizationId }, update);
  try {
    const organizationService = require('../organizationService');
    await organizationService.invalidateOrganizationCache(organizationId);
  } catch (error) {
    // Never fail the purchase because a cache drop failed. Worst case the
    // caller reads a stale subscription status until the TTL expires.
    logger.warn('Failed to invalidate organization cache after subscription update', {
      organizationId: String(organizationId),
      error: error.message,
    });
  }
}

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

  await updateOrganizationSubscription(organizationId, {
    $set: {
      'subscription.entitlementId': entitlement._id,
      'subscription.lastVerifiedAt': now,
    },
  });
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
    await updateOrganizationSubscription(organizationId, {
      $set: {
        'subscription.entitlementId': active._id,
        'subscription.status': 'active',
        'subscription.expiresAt': active.expiresAt,
        'subscription.graceEndsAt': active.graceEndsAt,
        'subscription.source': active.source,
      },
    });
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
    await updateOrganizationSubscription(organizationId, {
      $set: {
        'subscription.entitlementId': grace._id,
        'subscription.status': 'grace',
        'subscription.expiresAt': grace.expiresAt,
        'subscription.graceEndsAt': grace.graceEndsAt,
      },
    });
    return { status: 'grace', expiresAt: grace.expiresAt };
  }

  // No active or grace entitlement. Only touch the org status if it
  // previously had at least one entitlement (a purchase was made and it
  // lapsed/refunded/revoked). New organisations with no purchase history
  // remain 'none'.
  const latest = await Entitlement.findOne({ organizationId })
    .sort({ expiresAt: -1, updatedAt: -1 })
    .lean();
  if (latest) {
    let status = 'expired';
    if (latest.status === 'revoked') status = 'revoked';
    else if (latest.status === 'refunded') status = 'refunded';

    await updateOrganizationSubscription(organizationId, {
      $set: { 'subscription.status': status },
    });
    return { status };
  }

  // No purchase has ever been made — leave 'none' so the gate does not block.
  return { status: 'none' };
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

  /**
   * DEV ONLY: remove all entitlements for an organisation and reset its cached
   * subscription status so the paywall can be re-tested from scratch.
   */
  async resetOrganizationEntitlements(organizationId) {
    const result = await Entitlement.deleteMany({ organizationId });
    await updateOrganizationSubscription(organizationId, {
      $set: { 'subscription.status': 'none' },
      $unset: {
        'subscription.entitlementId': '',
        'subscription.expiresAt': '',
        'subscription.graceEndsAt': '',
        'subscription.lastVerifiedAt': '',
        'subscription.source': '',
      },
    });

    logger.warn('Organization entitlements reset (dev only)', {
      organizationId: String(organizationId),
      deleted: result.deletedCount,
    });

    return { deleted: result.deletedCount, status: 'none' };
  },

  refreshOrganizationStatus,
  appleConfigured: () => appleVerifier.isConfigured(),
  googleConfigured: () => googleVerifier.isConfigured(),
};

module.exports = entitlementService;
