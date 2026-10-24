const mongoose = require('mongoose');

/**
 * A generated NDIS Bulk Payment Request (BPR) batch (Phase 6).
 * See docs/NDIS_DEPTH_ROADMAP.md section 5.4.
 *
 * Only NDIA-managed claims are batched here; plan-managed and self-managed work
 * is invoiced (PDF) instead. There is no public NDIA API: the batch produces a
 * CSV the provider uploads to the myplace/PACE portal, then imports the Bulk
 * Payment Results File (BPRF) to reconcile.
 */
const claimBatchSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    status: {
      type: String,
      enum: ['draft', 'generated', 'submitted', 'reconciled', 'paid', 'partial', 'failed'],
      default: 'draft',
      index: true,
    },
    fundingType: { type: String, enum: ['ndia_managed'], default: 'ndia_managed' },
    // Storage reference for the generated CSV.
    //  - storageProvider 'r2'     → `fileRef` is the R2 object key; `fileUrl` is its public URL.
    //  - storageProvider 'inline' → R2 was unavailable, so `fileRef` holds the CSV as base64.
    fileRef: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    storageProvider: { type: String, enum: ['r2', 'inline', ''], default: '' },
    registrationNumber: { type: String, default: '' },
    abn: { type: String, default: '' },
    totals: {
      lines: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
    },
    generatedBy: { type: String, default: '' },
    generatedAt: { type: Date, default: null },
    // Submission evidence (the portal has no public API, so this records the
    // human/automation that uploaded the BPR and the portal receipt/date).
    submittedBy: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
    portalReference: { type: String, default: '' },
    // Remittance/payment reconciliation from the Bulk Payment Results File.
    remittance: {
      status: {
        type: String,
        enum: ['unpaid', 'part_paid', 'paid'],
        default: 'unpaid',
      },
      paidAmount: { type: Number, default: 0 },
      paidAt: { type: Date, default: null },
      reference: { type: String, default: '' },
      notes: { type: String, default: '' },
      importedBy: { type: String, default: '' },
      importedAt: { type: Date, default: null },
    },
    // Rejected-line resubmission links.
    resubmissionOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClaimBatch',
      default: null,
    },
    resubmittedBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClaimBatch',
      default: null,
    },
    reconciledAt: { type: Date, default: null },
    createdBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'claimBatches',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.period?.from) ret.period.from = new Date(ret.period.from).toISOString();
        if (ret.period?.to) ret.period.to = new Date(ret.period.to).toISOString();
        if (ret.generatedAt) ret.generatedAt = ret.generatedAt.toISOString();
        if (ret.submittedAt) ret.submittedAt = new Date(ret.submittedAt).toISOString();
        if (ret.remittance?.paidAt) {
          ret.remittance.paidAt = new Date(ret.remittance.paidAt).toISOString();
        }
        if (ret.remittance?.importedAt) {
          ret.remittance.importedAt = new Date(ret.remittance.importedAt).toISOString();
        }
        if (ret.resubmissionOf) ret.resubmissionOf = ret.resubmissionOf.toString();
        if (ret.resubmittedBatchId) ret.resubmittedBatchId = ret.resubmittedBatchId.toString();
        if (ret.reconciledAt) ret.reconciledAt = ret.reconciledAt.toISOString();
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

claimBatchSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('ClaimBatch', claimBatchSchema);
