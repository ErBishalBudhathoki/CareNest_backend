const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    channels: {
      type: [String],
      default: ['push'],
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'scheduled', 'sent', 'read', 'failed'],
      default: 'pending',
      index: true,
    },
    scheduledFor: {
      type: Date,
      index: true,
    },
    sentAt: Date,
    readAt: Date,
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
