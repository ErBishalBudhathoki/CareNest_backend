const mongoose = require('mongoose');

/**
 * The agreed roster-of-care for a participant's SIL supports, created by
 * converting an accepted quote. Versioned via a history log.
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.6.
 */
const rocSupportSchema = new mongoose.Schema(
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
  },
  { _id: false },
);

const silRosterOfCareSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SILProperty', default: null },
    quoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'SILQuote', default: null },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    supports: { type: [rocSupportSchema], default: [] },
    reviewSchedule: {
      cadence: { type: String, enum: ['monthly', 'quarterly', 'annual'], default: 'quarterly' },
      nextReviewDate: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'under_review', 'ended'],
      default: 'draft',
      index: true,
    },
    history: {
      type: [
        {
          changedAt: { type: Date, default: Date.now },
          changedBy: { type: String, default: '' },
          change: { type: String, default: '' },
        },
      ],
      default: [],
    },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'silRostersOfCare',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.clientId) ret.clientId = ret.clientId.toString();
        if (ret.propertyId) ret.propertyId = ret.propertyId.toString();
        if (ret.quoteId) ret.quoteId = ret.quoteId.toString();
        if (ret.effectiveFrom) ret.effectiveFrom = ret.effectiveFrom.toISOString();
        if (ret.effectiveTo) ret.effectiveTo = ret.effectiveTo.toISOString();
        if (ret.reviewSchedule?.nextReviewDate) {
          ret.reviewSchedule.nextReviewDate = ret.reviewSchedule.nextReviewDate.toISOString();
        }
        if (Array.isArray(ret.history)) {
          ret.history = ret.history.map((h) => ({
            ...h,
            changedAt: h.changedAt ? new Date(h.changedAt).toISOString() : null,
          }));
        }
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

silRosterOfCareSchema.index({ organizationId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model('SILRosterOfCare', silRosterOfCareSchema);
