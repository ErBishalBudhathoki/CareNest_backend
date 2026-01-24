const mongoose = require('mongoose');

const engagementFeedbackSchema = new mongoose.Schema({
  notificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NotificationHistory',
    required: true,
    index: true
  },
  engaged: {
    type: Boolean,
    required: true
  },
  engagementTime: {
    type: Date
  },
  engagementType: {
    type: String, // 'click', 'dismiss', 'snooze'
    required: true
  },
  contextData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('EngagementFeedback', engagementFeedbackSchema);
