const mongoose = require('mongoose');

/**
 * Service Agreement Model (Milestone 4.2)
 * Represents an NDIS Service Agreement between the provider and participant/nominee.
 * Acts as a mandatory consent gate before a SIL Roster of Care can transition from 'draft' to 'active'.
 *
 * See NDIS_SIL_INVOICING_INTEGRATION_SPEC.md (Milestone 4.2)
 */
const serviceAgreementSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SILProperty',
      default: null,
      index: true,
    },
    quoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SILQuote',
      default: null,
    },
    rosterOfCareId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SILRosterOfCare',
      default: null,
    },
    agreementNumber: {
      type: String,
      required: true,
      trim: true,
    },
    agreementType: {
      type: String,
      enum: ['sil', 'core_supports', 'capacity_building', 'general'],
      default: 'sil',
    },
    status: {
      type: String,
      enum: ['draft', 'pending_signature', 'signed', 'active', 'expired', 'terminated'],
      default: 'draft',
      index: true,
    },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    signedAt: { type: Date, default: null },
    signedBy: {
      name: { type: String, default: '' },
      role: {
        type: String,
        enum: ['participant', 'guardian', 'nominee', 'advocate', 'provider', ''],
        default: 'participant',
      },
      signatureData: { type: String, default: '' },
      ipAddress: { type: String, default: '' },
    },
    participantContribution: {
      boardAndLodgingWeekly: { type: Number, default: 0 },
      paymentFrequency: {
        type: String,
        enum: ['weekly', 'fortnightly', 'monthly'],
        default: 'fortnightly',
      },
    },
    nomineeConsent: {
      nomineeName: { type: String, default: '' },
      relationship: { type: String, default: '' },
      paceEndorsed: { type: Boolean, default: false },
    },
    notes: { type: String, default: '' },
    signedPdfUrl: { type: String, default: '' },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'serviceAgreements',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.clientId) ret.clientId = ret.clientId.toString();
        if (ret.propertyId) ret.propertyId = ret.propertyId.toString();
        if (ret.quoteId) ret.quoteId = ret.quoteId.toString();
        if (ret.rosterOfCareId) ret.rosterOfCareId = ret.rosterOfCareId.toString();
        if (ret.effectiveFrom) ret.effectiveFrom = ret.effectiveFrom.toISOString();
        if (ret.effectiveTo) ret.effectiveTo = ret.effectiveTo.toISOString();
        if (ret.signedAt) ret.signedAt = ret.signedAt.toISOString();
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

serviceAgreementSchema.index({ organizationId: 1, clientId: 1, status: 1 });
serviceAgreementSchema.index({ organizationId: 1, agreementNumber: 1 }, { unique: true });

module.exports = mongoose.model('ServiceAgreement', serviceAgreementSchema);

