const mongoose = require('mongoose');

/**
 * Hosted checkout grant: a single-use, hashable token that the organization
 * sends to a client (by email, SMS, or PDF link) so the client can pay
 * without logging into CareNest. The grant is bound to a specific invoice,
 * amount, currency, and connected Stripe account.
 */
const hostedCheckoutGrantSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    stripeAccountId: { type: String, required: true },
    stripeCheckoutSessionId: { type: String },
    status: {
      type: String,
      enum: ['active', 'consumed', 'revoked', 'expired'],
      default: 'active',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date },
    createdBy: { type: String, required: true },
    lastAccessedAt: { type: Date },
  },
  { timestamps: true, collection: 'hosted_checkout_grants' }
);

hostedCheckoutGrantSchema.index({ organizationId: 1, invoiceId: 1, status: 1 });

module.exports = mongoose.model(
  'HostedCheckoutGrant',
  hostedCheckoutGrantSchema
);
