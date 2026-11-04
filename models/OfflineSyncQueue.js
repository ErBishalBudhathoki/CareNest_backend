const mongoose = require('mongoose');

/**
 * Persistent Offline Sync Queue (Milestone 7.1 / Phase 7 Appendix B).
 * Stores offline operations (WorkedTime, disturbances, client assignments, notes)
 * captured by mobile workers when connectivity was interrupted, enabling reliable
 * replay and conflict detection without data loss across server restarts.
 */
const offlineSyncQueueSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    queueId: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, default: '', index: true },
    dataType: {
      type: String,
      required: true,
      enum: ['worked_time', 'disturbance', 'note', 'appointment', 'invoice', 'claim', 'client', 'other'],
      default: 'other',
    },
    action: {
      type: String,
      required: true,
      enum: ['create', 'update', 'delete', 'sync'],
      default: 'create',
    },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'synced', 'failed', 'conflict'],
      default: 'queued',
      index: true,
    },
    retryCount: { type: Number, default: 0 },
    error: { type: String, default: '' },
    syncedAt: { type: Date, default: null },
    deviceTimestamp: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'offlineSyncQueues',
  }
);

offlineSyncQueueSchema.index({ organizationId: 1, status: 1 });
offlineSyncQueueSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('OfflineSyncQueue', offlineSyncQueueSchema);

