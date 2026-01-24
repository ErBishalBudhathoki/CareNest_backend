
const mongoose = require('mongoose');

const clientAssignmentSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  clientEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  organizationId: {
    type: String,
    required: true
  },
  schedule: [{
    date: String,
    startTime: String,
    endTime: String,
    break: String,
    highIntensity: Boolean,
    ndisItem: Object
  }],
  status: {
    type: String,
    enum: ['active', 'inactive', 'completed'],
    default: 'active'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Legacy support fields
  dateList: [String],
  startTimeList: [String],
  endTimeList: [String],
  breakList: [String]
}, {
  timestamps: true
});

// Indexes
clientAssignmentSchema.index({ userEmail: 1, clientEmail: 1 });
clientAssignmentSchema.index({ organizationId: 1 });

module.exports = mongoose.model('ClientAssignment', clientAssignmentSchema);
