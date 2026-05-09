const mongoose = require('mongoose');

/**
 * HubConversation
 *
 * Stores 1-to-1 or group conversation threads for the Communication Hub.
 * This is COMPLETELY SEPARATE from `messageConversations` (shift/client chats).
 *
 * Collection: hub_conversations
 */
const hubConversationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    // Sorted array of participant user IDs or emails (normalized to lowercase)
    participants: {
      type: [String],
      required: true,
      index: true,
    },
    // Display names keyed by participant token for quick lookups
    participantNames: {
      type: Map,
      of: String,
      default: {},
    },
    lastMessage: {
      type: String,
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastSenderId: {
      type: String,
      default: null,
    },
    // Map of userId/email -> unread count
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
    // 'direct' for 1-to-1, 'group' for multi-person threads
    type: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct',
    },
    // For group chats: a display name
    groupName: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    collection: 'hub_conversations',
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret.__v;
        if (ret.unreadCount instanceof Map) {
          ret.unreadCount = Object.fromEntries(ret.unreadCount.entries());
        }
        if (ret.participantNames instanceof Map) {
          ret.participantNames = Object.fromEntries(ret.participantNames.entries());
        }
        return ret;
      },
    },
  }
);

// Compound index for fast participant-based lookups
hubConversationSchema.index({ participants: 1, organizationId: 1 });
hubConversationSchema.index({ organizationId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('HubConversation', hubConversationSchema);
