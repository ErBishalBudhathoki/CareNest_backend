const mongoose = require('mongoose');

const notificationHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['shift', 'geofence', 'expense', 'timesheet'],
    index: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  body: {
    type: String,
    required: true,
    maxlength: 500
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    required: true,
    enum: ['scheduled', 'sent', 'delivered', 'read', 'failed'],
    default: 'scheduled',
    index: true
  },
  scheduledAt: {
    type: Date,
    required: true,
    index: true
  },
  sentAt: {
    type: Date,
    index: true
  },
  deliveredAt: {
    type: Date
  },
  readAt: {
    type: Date
  },
  error: {
    type: String,
    maxlength: 500
  },
  fcmMessageId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for performance
notificationHistorySchema.index({ userId: 1, status: 1 });
notificationHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });
notificationHistorySchema.index({ scheduledAt: 1, status: 1 });

module.exports = mongoose.model('NotificationHistory', notificationHistorySchema);
