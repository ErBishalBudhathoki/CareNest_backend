const mongoose = require('mongoose');

const secureMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    senderType: {
      type: String,
      default: 'client',
      trim: true,
      lowercase: true,
    },
    senderName: {
      type: String,
      default: null,
      trim: true,
    },
    recipientId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    attachments: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    readBy: {
      type: String,
      default: null,
      trim: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    type: {
      type: String,
      default: 'text',
      trim: true,
      lowercase: true,
    },
  },
  {
    collection: 'secureMessages',
    timestamps: true,
  }
);

secureMessageSchema.index({ conversationId: 1, timestamp: -1 });

module.exports = mongoose.model('SecureMessage', secureMessageSchema);
