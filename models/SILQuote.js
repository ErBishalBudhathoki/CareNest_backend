const mongoose = require('mongoose');

/**
 * A priced SIL quote for a participant. Lines are embedded (like invoice
 * line items) so a quote is atomic and easy to convert into a roster-of-care.
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.5.
 */
const quoteLineSchema = new mongoose.Schema(
  {
    supportNumber: { type: String, required: true, trim: true },
    supportName: { type: String, default: '', trim: true },
    shiftType: {
      type: String,
      enum: ['day', 'evening', 'active_night', 'sleepover', 'split'],
      default: 'day',
    },
    hoursPerWeek: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    gstCode: { type: String, default: 'P2' },
    amount: { type: Number, default: 0 },
    priceValidation: {
      passed: { type: Boolean, default: true },
      capApplied: { type: Number, default: null },
      type: { type: String, default: null },
      errors: { type: [String], default: [] },
    },
  },
  { _id: false },
);

const silQuoteSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SILProperty', default: null },
    status: {
      type: String,
      enum: ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted'],
      default: 'draft',
      index: true,
    },
    fundingType: {
      type: String,
      enum: ['ndia_managed', 'plan_managed', 'self_managed'],
      default: 'plan_managed',
    },
    validUntil: { type: Date, default: null },
    lines: { type: [quoteLineSchema], default: [] },
    totals: {
      weeklyHours: { type: Number, default: 0 },
      weeklyAmount: { type: Number, default: 0 },
      annualAmount: { type: Number, default: 0 },
    },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    rosterOfCareId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SILRosterOfCare',
      default: null,
    },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'silQuotes',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.clientId) ret.clientId = ret.clientId.toString();
        if (ret.propertyId) ret.propertyId = ret.propertyId.toString();
        if (ret.rosterOfCareId) ret.rosterOfCareId = ret.rosterOfCareId.toString();
        if (ret.validUntil) ret.validUntil = ret.validUntil.toISOString();
        if (ret.approvedAt) ret.approvedAt = ret.approvedAt.toISOString();
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

silQuoteSchema.index({ organizationId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model('SILQuote', silQuoteSchema);
