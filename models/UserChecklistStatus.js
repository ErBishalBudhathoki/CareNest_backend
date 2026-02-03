const mongoose = require('mongoose');

const userChecklistStatusSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  checklistId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ComplianceChecklist',
    required: true,
    index: true
  },
  completedItems: {
    type: [String], // Array of item IDs that are checked
    default: []
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date
  },
  notes: String
}, {
  timestamps: true,
  collection: 'userChecklistStatus',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      if (ret.completedAt) ret.completedAt = ret.completedAt.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Unique compound index
userChecklistStatusSchema.index({ userId: 1, checklistId: 1 }, { unique: true });

module.exports = mongoose.model('UserChecklistStatus', userChecklistStatusSchema);
