const mongoose = require('mongoose');

const scheduleItemSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  break: {
    type: String,
    default: '0'
  },
  highIntensity: {
    type: Boolean,
    default: false
  },
  ndisItem: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, { _id: false });

const clientAssignmentSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  clientEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  organizationId: {
    type: String,
    required: true
  },
  schedule: [scheduleItemSchema],
  assignedNdisItemNumber: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'clientAssignments'
});

// Indexes
clientAssignmentSchema.index({ userEmail: 1, clientEmail: 1, isActive: 1 });
clientAssignmentSchema.index({ organizationId: 1 });
clientAssignmentSchema.index({ clientId: 1 });

module.exports = mongoose.model('ClientAssignment', clientAssignmentSchema);
