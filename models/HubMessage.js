const mongoose = require('mongoose');

/**
 * HubMessage
 *
 * Stores individual messages sent within a HubConversation thread.
 * This is COMPLETELY SEPARATE from `secureMessages` (shift/client chats).
 *
 * Collection: hub_messages
 */
const hubMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HubConversation',
      required: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    senderName: {
      type: String,
      default: null,
      trim: true,
    },
    // Content of the message (plain text for internal hub — not encrypted)
    content: {
      type: String,
      required: true,
      trim: true,
    },
    // 'text' | 'image' | 'file'
    messageType: {
      type: String,
      default: 'text',
      enum: ['text', 'image', 'file'],
    },
    attachments: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    // Map of userId -> true indicating who has read this message
    readBy: {
      type: Map,
      of: Boolean,
      default: {},
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    collection: 'hub_messages',
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret.__v;
        if (ret.readBy instanceof Map) {
          ret.readBy = Object.fromEntries(ret.readBy.entries());
        }
        return ret;
      },
    },
  }
);

hubMessageSchema.index({ conversationId: 1, createdAt: -1 });
hubMessageSchema.index({ senderId: 1, createdAt: -1 });

module.exports = mongoose.model('HubMessage', hubMessageSchema);
