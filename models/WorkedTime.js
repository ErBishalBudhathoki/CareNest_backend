
const mongoose = require('mongoose');

const workedTimeSchema = new mongoose.Schema({
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
  shiftDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  totalSeconds: {
    type: Number,
    required: true,
    min: 0
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  servicesProvided: [{
    type: String,
    enum: ['personal_care', 'medication', 'meal_prep', 'housekeeping', 'companionship', 'transportation']
  }],
  status: {
    type: String,
    enum: ['completed', 'cancelled', 'no_show'],
    default: 'completed'
  },
  assignedClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClientAssignment'
  },
  shiftIndex: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
workedTimeSchema.index({ userEmail: 1, clientEmail: 1 });
workedTimeSchema.index({ shiftDate: -1 });
workedTimeSchema.index({ startTime: -1 });

module.exports = mongoose.model('WorkedTime', workedTimeSchema);
