const mongoose = require('mongoose');

const calendarEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Linking to the existing User/Login model (usually 'User' or 'login' in this codebase)
    required: true,
    index: true
  },
  eventType: {
    type: String,
    required: true // 'meeting', 'focus_time', 'out_of_office'
  },
  startTime: {
    type: Date,
    required: true,
    index: true
  },
  endTime: {
    type: Date,
    required: true,
    index: true
  },
  attendees: [{
    email: String,
    status: String
  }],
  isFocusTime: {
    type: Boolean,
    default: false
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Index for efficient time-range queries
calendarEventSchema.index({ userId: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model('CalendarEvent', calendarEventSchema);
