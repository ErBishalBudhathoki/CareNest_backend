const mongoose = require('mongoose');

/**
 * Entitlement: server-verified subscription that unlocks CareNest for an
 * organization. The mobile app's app-store "purchase success" message is
 * NEVER trusted; the backend must verify the receipt and store the result.
 *
 * The organization model holds a pointer (`subscription.entitlementId`) and
 * a derived cached status used by the access gate. Whenever the entitlement
 * changes, the cached status is updated by `entitlementService`.
 */
const entitlementSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['apple_app_store', 'google_play_store', 'manual'],
      required: true,
    },
    productId: { type: String, required: true },
    // Apple original transaction ID OR Google purchase token. Combined with
    // `source` to form a unique key that prevents replay across organizations.
    storeIdentifier: { type: String, required: true },
    status: {
      type: String,
      enum: [
        'pending_verification',
        'active',
        'billing_retry',
        'expired',
        'revoked',
        'refunded',
      ],
      default: 'pending_verification',
      index: true,
    },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'production' },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    graceEndsAt: { type: Date, required: true },
    lastReceiptPayload: mongoose.Schema.Types.Mixed,
    lastVerifiedAt: { type: Date, default: Date.now },
    failureReason: { type: String },
  },
  { timestamps: true, collection: 'entitlements' }
);

entitlementSchema.index(
  { source: 1, storeIdentifier: 1 },
  { unique: true }
);
entitlementSchema.index({ organizationId: 1, status: 1, expiresAt: -1 });

module.exports = mongoose.model('Entitlement', entitlementSchema);
