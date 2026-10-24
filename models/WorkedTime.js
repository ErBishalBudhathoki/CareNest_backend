const mongoose = require('mongoose');

const workedTimeSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true
  },
  clientEmail: {
    type: String,
    required: true, // Legacy required, but maybe optional if non-client work? Keeping as required to match existing
    index: true,
    trim: true,
    lowercase: true
  },
  workDate: {
    type: Date,
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    index: true
  },
  // Legacy fields kept for backward compatibility if needed, but workDate is primary
  shiftDate: { type: String }, // YYYY-MM-DD
  date: { type: Date }, // Legacy alias?
  shiftStartTime: { type: String },
  shiftEndTime: { type: String },
  shiftBreak: { type: mongoose.Schema.Types.Mixed },
  shiftIndex: { type: Number, default: 0 },
  shiftKey: { type: String },
  // Idempotency key for offline replay: a retried save returns the original
  // row instead of creating a duplicate worked-time record.
  clientRequestId: { type: String, default: null, index: true },
  assignedClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientAssignment' },
  // SIL roster shifts are not ClientAssignments; link the saved hours to the
  // Shift document instead so payroll/rostering can trace them.
  silShiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', index: true },
  ndisItem: { type: mongoose.Schema.Types.Mixed },
  highIntensity: { type: Boolean, default: false },
  startTime: { type: Date },
  endTime: { type: Date },
  totalSeconds: { type: Number, default: 0 },
  
  isActive: { 
    type: Boolean, 
    default: true,
    index: true 
  },
  
  timeWorked: {
    type: String, // "HH:mm:ss"
    required: true
  },
  totalHours: {
    type: Number, // Calculated hours for easier querying
    default: 0
  },
  
  providerType: {
    type: String,
    default: 'standard'
  },
  serviceLocationPostcode: {
    type: String,
    default: null
  },
  postcode: {
    type: String,
    default: null
  },
  state: {
    type: String,
    default: 'NSW'
  }
}, {
  timestamps: true,
  collection: 'worked_times',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.workDate) ret.workDate = ret.workDate.toISOString();
      if (ret.date) ret.date = ret.date.toISOString();
      if (ret.startTime) ret.startTime = ret.startTime.toISOString();
      if (ret.endTime) ret.endTime = ret.endTime.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Indexes
workedTimeSchema.index({ userEmail: 1, clientEmail: 1, workDate: 1 });
workedTimeSchema.index({ userEmail: 1, workDate: 1 });
workedTimeSchema.index({ organizationId: 1, workDate: 1 });
workedTimeSchema.index({ workDate: -1 });
// Org-scoped console analytics filter on organizationId + workDate; the
// per-tenant top-users grouping adds userEmail on the tail.
workedTimeSchema.index({ organizationId: 1, workDate: -1 });
workedTimeSchema.index({ organizationId: 1, workDate: -1, userEmail: 1 });

// The analytics pipelines in controllers/analyticsController.js do NOT filter on
// workDate. They match the legacy `shiftDate` string (YYYY-MM-DD) with a
// lexicographic range, because it is cheaper to compare than converting a Date.
// Every analytics endpoint was therefore collection-scanning WorkedTime, then
// running $lookup + $sort over the matched set. Index the field it actually
// filters on.
//
// Explicit names keep these in lockstep with scripts/migrate_dashboard_indexes.js;
// see the note in models/InvoiceLineItem.js about Mongo error 85.
workedTimeSchema.index(
  { organizationId: 1, shiftDate: 1 },
  { name: 'org_shiftDate_idx' }
);
// Cross-tenant reporting scans by date only.
workedTimeSchema.index({ shiftDate: 1 }, { name: 'shiftDate_idx' });
// Offline replay idempotency. Sparse so existing rows without the key are
// unaffected; unique so a retry cannot insert a second row.
workedTimeSchema.index(
  { userEmail: 1, clientRequestId: 1 },
  { unique: true, sparse: true, name: 'user_request_id_unique' }
);

module.exports = mongoose.model('WorkedTime', workedTimeSchema);
