/**
 * Communication Hub Service
 *
 * Handles Admin ↔ Employee internal messaging for the Communication Hub.
 *
 * Collections used:
 *   - hub_conversations  (HubConversation model)
 *   - hub_messages       (HubMessage model)
 *   - communication_broadcasts (CommunicationBroadcast model)
 *
 * These are SEPARATE from:
 *   - messageConversations (shift-based Worker ↔ Client secure chats)
 *   - secureMessages       (encrypted shift messages)
 */

const mongoose = require('mongoose');
const HubConversation = require('../models/HubConversation');
const HubMessage = require('../models/HubMessage');
const CommunicationBroadcast = require('../models/CommunicationBroadcast');
const User = require('../models/User');

const normalizeToken = (val) => (val || '').toString().trim().toLowerCase();

/**
 * Find or create a direct 1-to-1 conversation between two participants.
 */
async function findOrCreateDirectConversation({ organizationId, senderToken, recipientToken }) {
  // Participants are always stored sorted so the same pair always has the same doc.
  const participants = [senderToken, recipientToken].sort();

  let conversation = await HubConversation.findOne({
    organizationId,
    participants: { $all: participants, $size: 2 },
    type: 'direct',
  });

  if (!conversation) {
    conversation = await HubConversation.create({
      organizationId,
      participants,
      type: 'direct',
      isActive: true,
    });
  }

  return conversation;
}

/**
 * Resolve a display name for a given token (email or userId).
 */
async function resolveDisplayName(token) {
  if (!token) return token;
  try {
    let user = null;
    if (mongoose.Types.ObjectId.isValid(token)) {
      user = await User.findById(token).select('firstName lastName email').lean();
    } else {
      user = await User.findOne({ email: token }).select('firstName lastName email').lean();
    }
    if (user) {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      return name || user.email || token;
    }
  } catch (_) {}
  return token;
}

class CommunicationHubService {

  // ─────────────────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all hub conversations for the authenticated user.
   * Uses hub_conversations collection ONLY (never messageConversations).
   */
  async getConversations(userId, authUser) {
    try {
      const userTokens = [
        normalizeToken(userId),
        normalizeToken(authUser?.email),
        normalizeToken(authUser?.userId),
        normalizeToken(authUser?.id),
      ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

      if (!userTokens.length) {
        return { success: true, data: [] };
      }

      const conversations = await HubConversation.find({
        participants: { $in: userTokens },
        isActive: true,
      })
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .lean();

      const mapped = await Promise.all(
        conversations.map(async (conv) => {
          // Find the "other" participant (the one that is not the current user)
          const otherToken = conv.participants.find(
            (p) => !userTokens.includes(normalizeToken(p))
          );

          // Try to get a friendly name from participantNames map or DB lookup
          let participantName = null;
          if (conv.participantNames) {
            const namesObj =
              conv.participantNames instanceof Map
                ? Object.fromEntries(conv.participantNames.entries())
                : conv.participantNames;
            participantName = namesObj[otherToken] || null;
          }
          if (!participantName && otherToken) {
            participantName = await resolveDisplayName(otherToken);
          }
          if (!participantName) participantName = otherToken || 'Unknown Participant';

          const unreadObj =
            conv.unreadCount instanceof Map
              ? Object.fromEntries(conv.unreadCount.entries())
              : (conv.unreadCount || {});

          const myUnread = userTokens.reduce((sum, t) => sum + (unreadObj[t] || 0), 0);

          return {
            conversationId: conv._id.toString(),
            participantName,
            participantToken: otherToken || null,
            lastMessage: conv.lastMessage || 'No messages yet',
            lastMessageTime: conv.lastMessageAt || conv.createdAt || new Date().toISOString(),
            unreadCount: myUnread,
            type: conv.type || 'direct',
          };
        })
      );

      return { success: true, data: mapped };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get messages for a hub conversation.
   * Uses hub_messages collection ONLY (never secureMessages).
   */
  async getMessages(conversationId, authUser) {
    try {
      const conversation = await HubConversation.findById(conversationId).lean();
      if (!conversation) {
        return { success: false, message: 'Conversation not found' };
      }

      // Auth check — user must be a participant
      const userTokens = [
        normalizeToken(authUser?.email),
        normalizeToken(authUser?.userId),
        normalizeToken(authUser?.id),
      ].filter(Boolean);

      const isParticipant = conversation.participants.some((p) =>
        userTokens.includes(normalizeToken(p))
      );
      if (!isParticipant) {
        return { success: false, message: 'Access denied' };
      }

      const messages = await HubMessage.find({
        conversationId: new mongoose.Types.ObjectId(conversationId),
        isDeleted: false,
      })
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();

      // Mark messages as read for this user
      const userToken = userTokens[0];
      await HubMessage.updateMany(
        {
          conversationId: new mongoose.Types.ObjectId(conversationId),
          senderId: { $nin: userTokens },
          [`readBy.${userToken}`]: { $ne: true },
        },
        { $set: { [`readBy.${userToken}`]: true } }
      );

      // Reset unread count for this user in the conversation
      const unreadUpdate = {};
      userTokens.forEach((t) => { unreadUpdate[`unreadCount.${t}`] = 0; });
      await HubConversation.updateOne(
        { _id: conversationId },
        { $set: unreadUpdate }
      );

      const mapped = messages.map((msg) => ({
        messageId: msg._id.toString(),
        senderId: msg.senderId,
        senderName: msg.senderName || msg.senderId,
        message: msg.content,
        timestamp: msg.createdAt || new Date().toISOString(),
        read: msg.readBy ? Object.keys(msg.readBy).length > 1 : false,
        messageType: msg.messageType || 'text',
        attachments: msg.attachments || [],
      }));

      return { success: true, data: mapped };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Send Message (In-App only — SMS/Email handled by native device)
  // ─────────────────────────────────────────────────────────────────────────

  async sendMessage(messageData) {
    try {
      const { senderId, recipientId, message, channel, organizationId, authUser } = messageData;

      if (channel === 'In-App') {
        if (!senderId || !recipientId || !message) {
          return { success: false, message: 'senderId, recipientId and message are required' };
        }

        const senderToken = normalizeToken(senderId);
        const recipientToken = normalizeToken(recipientId);

        // Find or create the 1-to-1 conversation in hub_conversations
        const conversation = await findOrCreateDirectConversation({
          organizationId,
          senderToken,
          recipientToken,
        });

        // Resolve sender's display name
        const senderName = await resolveDisplayName(senderToken);

        // Save the message to hub_messages
        const hubMsg = await HubMessage.create({
          conversationId: conversation._id,
          senderId: senderToken,
          senderName,
          content: message,
          messageType: 'text',
          readBy: { [senderToken]: true },
        });

        // Update conversation metadata
        const currentUnread = conversation.unreadCount instanceof Map
          ? Object.fromEntries(conversation.unreadCount.entries())
          : (conversation.unreadCount || {});
        const newUnread = { ...currentUnread };
        newUnread[recipientToken] = (newUnread[recipientToken] || 0) + 1;

        await HubConversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: message,
              lastMessageAt: hubMsg.createdAt,
              lastSenderId: senderToken,
              unreadCount: newUnread,
              [`participantNames.${senderToken}`]: senderName,
            },
          }
        );

        return {
          success: true,
          data: {
            messageId: hubMsg._id.toString(),
            conversationId: conversation._id.toString(),
            senderId: senderToken,
            senderName,
            message,
            channel: 'In-App',
            sentAt: hubMsg.createdAt,
          },
        };
      }

      // SMS / Email — handled by native device, just return success log
      return {
        success: true,
        data: {
          messageId: `MSG-${Date.now()}`,
          senderId,
          recipientId,
          message,
          channel: channel || 'external',
          sentAt: new Date().toISOString(),
          status: 'dispatched_to_device',
        },
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Broadcasts (use CommunicationBroadcast — communication_broadcasts collection)
  // ─────────────────────────────────────────────────────────────────────────

  async broadcastMessage(broadcastData, initiatorId) {
    try {
      const { organizationId, group, type, message } = broadcastData;

      const broadcast = new CommunicationBroadcast({
        organizationId,
        initiatorId,
        type: type || 'announcement',
        targetGroup: group || 'All Workers',
        message,
        status: 'active',
        acknowledgments: [],
      });

      await broadcast.save();

      return { success: true, data: broadcast };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getActiveBroadcasts(organizationId) {
    try {
      if (!organizationId) throw new Error('Organization ID is required');

      const active = await CommunicationBroadcast.find({
        organizationId: new mongoose.Types.ObjectId(String(organizationId)),
        status: 'active',
      }).sort({ createdAt: -1 });

      return { success: true, data: active };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getBroadcastHistory(organizationId) {
    try {
      if (!organizationId) throw new Error('Organization ID is required');

      const history = await CommunicationBroadcast.find({
        organizationId: new mongoose.Types.ObjectId(String(organizationId)),
      }).sort({ createdAt: -1 });

      return { success: true, data: history };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async acknowledgeBroadcast(broadcastId, userId) {
    try {
      const broadcast = await CommunicationBroadcast.findByIdAndUpdate(
        broadcastId,
        { $addToSet: { acknowledgments: new mongoose.Types.ObjectId(String(userId)) } },
        { new: true }
      );

      if (!broadcast) throw new Error('Broadcast not found');

      return { success: true, data: broadcast };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new CommunicationHubService();
