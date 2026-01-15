const mongoose = require('mongoose');

const userChecklistStatusSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  checklistId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ComplianceChecklist',
    required: true
  },
  itemsStatus: {
    type: Map,
    of: Boolean, // itemId -> isChecked
    default: {}
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

userChecklistStatusSchema.index({ userId: 1, checklistId: 1 }, { unique: true });

module.exports = mongoose.model('UserChecklistStatus', userChecklistStatusSchema);
