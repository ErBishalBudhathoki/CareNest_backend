const mongoose = require('mongoose');

const workedTimeSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  clientEmail: {
    type: String,
    required: true,
    index: true
  },
  date: {
    type: Date
  },
  // Fields used in timesheetReminderService query
  shiftDate: String, // YYYY-MM-DD
  workDate: Date,
  isActive: { type: Boolean, default: true },
  
  timeWorked: {
    type: String, // Stored as string in original service logic (parseFloat used later)
    required: true
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
  collection: 'worked_times'
});

// Compound index for efficient range queries
workedTimeSchema.index({ userEmail: 1, clientEmail: 1, date: 1 });
workedTimeSchema.index({ userEmail: 1, isActive: 1 });

module.exports = mongoose.model('WorkedTime', workedTimeSchema);
