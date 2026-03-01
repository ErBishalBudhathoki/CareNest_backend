const mongoose = require('mongoose');

const messageConversationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      trim: true,
    },
    appointmentId: {
      type: String,
      required: true,
      index: true,
    },
    assignmentId: {
      type: String,
      default: null,
    },
    scheduleId: {
      type: String,
      default: null,
      index: true,
    },
    organizationId: {
      type: String,
      default: null,
      index: true,
    },
    clientId: {
      type: String,
      required: true,
      index: true,
    },
    clientEmail: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      index: true,
    },
    workerId: {
      type: String,
      required: true,
      index: true,
    },
    workerEmail: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      index: true,
    },
    participants: {
      type: [String],
      default: [],
      index: true,
    },
    shiftStartAt: {
      type: Date,
      default: null,
    },
    shiftEndAt: {
      type: Date,
      default: null,
    },
    lastMessage: {
      type: String,
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  {
    collection: 'messageConversations',
    timestamps: true,
  }
);

messageConversationSchema.index({ appointmentId: 1, organizationId: 1 });
messageConversationSchema.index({ clientEmail: 1, workerEmail: 1, appointmentId: 1 });

module.exports = mongoose.model('MessageConversation', messageConversationSchema);
