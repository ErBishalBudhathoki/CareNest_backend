const mongoose = require('mongoose');

/**
 * Recurring invoice agreement: client-authorized consent that lets the
 * organization auto-charge a saved payment method on the connected Stripe
 * account at a regular cadence. The agreement is only `active` after a
 * verified SetupIntent / Checkout setup-mode completes.
 */
const recurringAgreementSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    invoiceTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
    },
    clientName: { type: String, required: true },
    clientEmail: { type: String, required: true, lowercase: true, trim: true },
    stripeCustomerId: { type: String, required: true },
    stripePaymentMethodId: { type: String, required: true },
    stripeAccountId: { type: String, required: true },
    frequency: { type: String, enum: ['weekly', 'fortnightly', 'monthly'], required: true },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    consentTextVersion: { type: String, required: true },
    consentTextHash: { type: String, required: true },
    consentIpAddress: { type: String },
    consentUserAgent: { type: String },
    consentedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['active', 'paused', 'canceled'],
      default: 'active',
      index: true,
    },
    nextRunAt: { type: Date, required: true, index: true },
    lastRunAt: { type: Date },
    canceledAt: { type: Date },
    canceledBy: { type: String },
    cancellationReason: { type: String },
  },
  { timestamps: true, collection: 'recurring_invoice_agreements' }
);

recurringAgreementSchema.index({ organizationId: 1, status: 1, nextRunAt: 1 });

module.exports = mongoose.model(
  'RecurringInvoiceAgreement',
  recurringAgreementSchema
);
