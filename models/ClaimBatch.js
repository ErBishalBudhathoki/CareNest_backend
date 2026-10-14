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
      enum: ['draft', 'generated', 'submitted', 'reconciled', 'partial', 'failed'],
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
