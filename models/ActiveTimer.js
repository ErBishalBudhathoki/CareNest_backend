const mongoose = require('mongoose');

const activeTimerSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  clientEmail: {
    type: String,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  organizationId: {
    type: String
  },
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'active_timers'
});

module.exports = mongoose.model('ActiveTimer', activeTimerSchema);
