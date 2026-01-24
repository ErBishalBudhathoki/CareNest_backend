const mongoose = require('mongoose');

const snoozeRuleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  conditions: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    required: true // e.g., { type: 'email', sender: 'newsletter' }
  },
  actions: {
    snoozeDuration: Number, // in minutes
    snoozeUntil: String // 'morning', 'evening', 'next_week'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  performanceMetrics: {
    timesTriggered: { type: Number, default: 0 },
    lastTriggered: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SnoozeRule', snoozeRuleSchema);
