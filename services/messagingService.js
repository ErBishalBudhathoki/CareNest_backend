/**
 * Messaging Service
 * Handles secure messaging with end-to-end encryption
 */

const crypto = require('crypto');

// In-memory storage for demo (use database in production)
const messages = new Map();
const conversations = new Map();

// Encryption key (in production, use environment variable and key management service)
const ENCRYPTION_KEY = crypto.randomBytes(32);

/**
 * Send message
 * @param {Object} params - Message parameters
 * @returns {Object} Message data
 */
exports.sendMessage = async (params) => {
  const {
    conversationId,
    senderId,
    senderType,
    recipientId,
    message,
    attachments,
    timestamp,
  } = params;

  // Encrypt message
  const encrypted = encryptMessage(message);

  const messageData = {
    _id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    conversationId,
    senderId,
    senderType,
    senderName: await getSenderName(senderId, senderType),
    recipientId,
    message: encrypted.encrypted,
    iv: encrypted.iv,
    attachments: attachments || [],
    timestamp,
    read: false,
    readAt: null,
  };

  // Store message
  if (!messages.has(conversationId)) {
    messages.set(conversationId, []);
  }
  messages.get(conversationId).push(messageData);

  // Update conversation
  updateConversation(conversationId, messageData);

  return {
    ...messageData,
    message: message, // Return decrypted for sender
  };
};

/**
 * Get messages for conversation
 * @param {String} conversationId - Conversation ID
 * @param {Object} options - Query options
 * @returns {Array} Messages
 */
exports.getMessages = async (conversationId, options = {}) => {
  const { limit = 50, before } = options;

  let conversationMessages = messages.get(conversationId) || [];

  // Filter by timestamp if 'before' is provided
  if (before) {
    conversationMessages = conversationMessages.filter(
      (msg) => new Date(msg.timestamp) < new Date(before)
    );
  }

  // Sort by timestamp (newest first)
  conversationMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Limit results
  conversationMessages = conversationMessages.slice(0, limit);

  // Decrypt messages
  return conversationMessages.map((msg) => ({
    ...msg,
    message: decryptMessage(msg.message, msg.iv),
  }));
};

/**
 * Mark message as read
 * @param {Object} params - Read parameters
 * @returns {Object} Updated message
 */
exports.markMessageAsRead = async (params) => {
  const { messageId, readBy, readAt } = params;

  // Find message
  for (const [conversationId, msgs] of messages.entries()) {
    const message = msgs.find((m) => m._id === messageId);
    if (message) {
      message.read = true;
      message.readBy = readBy;
      message.readAt = readAt;
      return message;
    }
  }

  throw new Error('Message not found');
};

/**
 * Create conversation
 * @param {Object} params - Conversation parameters
 * @returns {Object} Conversation data
 */
exports.createConversation = async (params) => {
  const { appointmentId, clientId, workerId, organizationId } = params;

  const conversationId = `conv-${appointmentId}`;

  const conversation = {
    _id: conversationId,
    appointmentId,
    clientId,
    workerId,
    organizationId,
    participants: [clientId, workerId],
    createdAt: new Date(),
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: {
      [clientId]: 0,
      [workerId]: 0,
    },
  };

  conversations.set(conversationId, conversation);

  return conversation;
};

/**
 * Get conversation
 * @param {String} conversationId - Conversation ID
 * @returns {Object} Conversation data
 */
exports.getConversation = async (conversationId) => {
  const conversation = conversations.get(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  return conversation;
};

/**
 * Get conversations for user
 * @param {String} userId - User ID
 * @returns {Array} Conversations
 */
exports.getUserConversations = async (userId) => {
  const userConversations = [];

  for (const [id, conv] of conversations.entries()) {
    if (conv.participants.includes(userId)) {
      userConversations.push(conv);
    }
  }

  // Sort by last message time
  userConversations.sort((a, b) => {
    const aTime = a.lastMessageAt || a.createdAt;
    const bTime = b.lastMessageAt || b.createdAt;
    return new Date(bTime) - new Date(aTime);
  });

  return userConversations;
};

/**
 * Send voice message
 * @param {Object} params - Voice message parameters
 * @returns {Object} Message data
 */
exports.sendVoiceMessage = async (params) => {
  const {
    conversationId,
    senderId,
    senderType,
    recipientId,
    audioUrl,
    duration,
    timestamp,
  } = params;

  const messageData = {
    _id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    conversationId,
    senderId,
    senderType,
    senderName: await getSenderName(senderId, senderType),
    recipientId,
    type: 'voice',
    audioUrl,
    duration,
    timestamp,
    read: false,
    readAt: null,
  };

  // Store message
  if (!messages.has(conversationId)) {
    messages.set(conversationId, []);
  }
  messages.get(conversationId).push(messageData);

  // Update conversation
  updateConversation(conversationId, messageData);

  return messageData;
};

/**
 * Send file attachment
 * @param {Object} params - File parameters
 * @returns {Object} Message data
 */
exports.sendFileAttachment = async (params) => {
  const {
    conversationId,
    senderId,
    senderType,
    recipientId,
    fileUrl,
    fileName,
    fileType,
    fileSize,
    message,
    timestamp,
  } = params;

  const attachment = {
    url: fileUrl,
    name: fileName,
    type: fileType,
    size: fileSize,
  };

  return await exports.sendMessage({
    conversationId,
    senderId,
    senderType,
    recipientId,
    message: message || `Sent a file: ${fileName}`,
    attachments: [attachment],
    timestamp,
  });
};

/**
 * Get unread message count
 * @param {String} userId - User ID
 * @returns {Number} Unread count
 */
exports.getUnreadCount = async (userId) => {
  let unreadCount = 0;

  for (const [conversationId, conv] of conversations.entries()) {
    if (conv.participants.includes(userId)) {
      unreadCount += conv.unreadCount[userId] || 0;
    }
  }

  return unreadCount;
};

/**
 * Search messages
 * @param {String} conversationId - Conversation ID
 * @param {String} query - Search query
 * @returns {Array} Matching messages
 */
exports.searchMessages = async (conversationId, query) => {
  const conversationMessages = messages.get(conversationId) || [];

  const results = conversationMessages.filter((msg) => {
    const decrypted = decryptMessage(msg.message, msg.iv);
    return decrypted.toLowerCase().includes(query.toLowerCase());
  });

  return results.map((msg) => ({
    ...msg,
    message: decryptMessage(msg.message, msg.iv),
  }));
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Encrypt message
 * @param {String} message - Plain text message
 * @returns {Object} Encrypted data
 */
function encryptMessage(message) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(message, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
  };
}

/**
 * Decrypt message
 * @param {String} encrypted - Encrypted message
 * @param {String} ivHex - IV in hex format
 * @returns {String} Decrypted message
 */
function decryptMessage(encrypted, ivHex) {
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return '[Encrypted message]';
  }
}

/**
 * Get sender name
 * @param {String} senderId - Sender ID
 * @param {String} senderType - Sender type
 * @returns {String} Sender name
 */
async function getSenderName(senderId, senderType) {
  // In production, fetch from database
  return `${senderType}-${senderId}`;
}

/**
 * Update conversation with last message
 * @param {String} conversationId - Conversation ID
 * @param {Object} messageData - Message data
 */
function updateConversation(conversationId, messageData) {
  const conversation = conversations.get(conversationId);
  if (!conversation) return;

  conversation.lastMessage = messageData.message;
  conversation.lastMessageAt = messageData.timestamp;

  // Increment unread count for recipient
  if (conversation.unreadCount[messageData.recipientId] !== undefined) {
    conversation.unreadCount[messageData.recipientId]++;
  }

  conversations.set(conversationId, conversation);
}

