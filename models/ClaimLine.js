const mongoose = require('mongoose');

/**
 * A single NDIS Bulk Payment Request claim line (Phase 6).
 * See docs/NDIS_DEPTH_ROADMAP.md section 5.4.
 *
 * `claimReference` must be unique across ALL past submissions (the portal
 * remembers references), so it carries a unique index.
 */
const claimLineSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClaimBatch', required: true, index: true },
    organizationId: { type: String, required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    ndisNumber: { type: String, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
    supportNumber: { type: String, required: true },
    serviceDate: { type: Date, required: true },
    quantity: { type: Number, default: 0 },
    hours: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    gstCode: { type: String, default: 'P2' },
    claimType: { type: String, default: 'STANDARD' },
    cancellationReason: { type: String, default: '' },
    authorisedBy: { type: String, default: '' },
    participantApproved: { type: String, enum: ['Y', 'N'], default: 'Y' },
    inKindFundingProgramCode: { type: String, default: '' },
    claimReference: { type: String, required: true, unique: true },
    requestedAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'reconciled'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'claimLines',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.batchId) ret.batchId = ret.batchId.toString();
        if (ret.clientId) ret.clientId = ret.clientId.toString();
        if (ret.invoiceId) ret.invoiceId = ret.invoiceId.toString();
        if (ret.shiftId) ret.shiftId = ret.shiftId.toString();
        if (ret.serviceDate) ret.serviceDate = ret.serviceDate.toISOString();
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

claimLineSchema.index({ organizationId: 1, status: 1 });
claimLineSchema.index({ batchId: 1, status: 1 });

module.exports = mongoose.model('ClaimLine', claimLineSchema);
