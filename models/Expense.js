const mongoose = require('mongoose');

const auditTrailSchema = new mongoose.Schema({
  action: String,
  performedBy: String,
  timestamp: Date,
  changes: String,
  reason: String
}, { _id: false });

const expenseSchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  clientId: {
    type: String,
    default: null
  },
  expenseDate: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  subcategory: {
    type: String,
    default: null
  },
  supportItemNumber: {
    type: String,
    default: null
  },
  supportItemName: {
    type: String,
    default: null
  },
  receiptUrl: {
    type: String,
    default: null
  },
  receiptMetadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  receiptFiles: {
    type: [String],
    default: null
  },
  receiptPhotos: {
    type: [String],
    default: null
  },
  fileDescription: {
    type: String,
    default: null
  },
  photoDescription: {
    type: String,
    default: null
  },
  isReimbursable: {
    type: Boolean,
    default: true
  },
  requiresApproval: {
    type: Boolean,
    default: false
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  submittedBy: {
    type: String,
    required: true
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  approvedBy: {
    type: String,
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectedBy: {
    type: String,
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  approvalNotes: {
    type: String,
    default: null
  },
  notes: {
    type: String,
    default: null
  },
  createdBy: {
    type: String,
    required: true
  },
  updatedBy: {
    type: String,
    required: true
  },
  deletedBy: {
    type: String,
    default: null
  },
  deletedAt: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  status: {
    type: String,
    default: 'submitted'
  },
  version: {
    type: Number,
    default: 1
  },
  auditTrail: [auditTrailSchema]
}, {
  timestamps: true,
  collection: 'expenses',
  toJSON: {
    transform: function (doc, ret) {
      // Transform _id to id (Flutter expects 'id' as string)
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      // Transform dates to ISO 8601 strings
      if (ret.expenseDate) ret.expenseDate = ret.expenseDate.toISOString();
      if (ret.submittedAt) ret.submittedAt = ret.submittedAt.toISOString();
      if (ret.approvedAt) ret.approvedAt = ret.approvedAt.toISOString();
      if (ret.rejectedAt) ret.rejectedAt = ret.rejectedAt.toISOString();
      if (ret.deletedAt) ret.deletedAt = ret.deletedAt.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      
      // Transform nested audit trail dates
      if (ret.auditTrail && Array.isArray(ret.auditTrail)) {
        ret.auditTrail = ret.auditTrail.map(entry => ({
          ...entry,
          timestamp: entry.timestamp ? entry.timestamp.toISOString() : null
        }));
      }
      
      return ret;
    }
  }
});

// Indexes
expenseSchema.index({ organizationId: 1, expenseDate: 1 });
expenseSchema.index({ clientId: 1 });
expenseSchema.index({ submittedBy: 1 });
expenseSchema.index({ approvalStatus: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
