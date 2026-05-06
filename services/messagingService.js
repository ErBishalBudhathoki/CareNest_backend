/**
 * Messaging Service
 * Persists conversations/messages and enforces participant access.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const MessageConversation = require('../models/MessageConversation');
const SecureMessage = require('../models/SecureMessage');
const ClientAssignment = require('../models/ClientAssignment');
const Client = require('../models/Client');
const User = require('../models/User');
const {
  buildChatWindow,
  getChatWindowClosedMessage,
  toShiftDateTime,
  ENFORCE_SHIFT_CHAT_WINDOW,
} = require('./chatWindowPolicy');

const encryptionSeed =
  process.env.MESSAGING_ENCRYPTION_KEY ||
  process.env.JWT_SECRET ||
  'dev-messaging-key-change-me';
const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(encryptionSeed)
  .digest();

const normalizeToken = (value) => (value || '').toString().trim().toLowerCase();
const normalizeEmail = (value) => normalizeToken(value);

const uniqueTokens = (tokens = []) => {
  const out = [];
  const seen = new Set();
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const isObjectIdString = (value) => mongoose.Types.ObjectId.isValid(value);

const getAuthTokens = (authUser) =>
  uniqueTokens([authUser?.userId, authUser?.email, authUser?.id]);

const getConversationTokens = (conversation) =>
  uniqueTokens([
    ...(Array.isArray(conversation?.participants) ? conversation.participants : []),
    conversation?.clientId,
    conversation?.clientEmail,
    conversation?.workerId,
    conversation?.workerEmail,
  ]);

const isAdmin = (authUser) => {
  const roles = Array.isArray(authUser?.roles) ? authUser.roles : [authUser?.role];
  return roles
    .map((role) => normalizeToken(role))
    .some((role) => role === 'admin' || role === 'superadmin');
};

const createForbiddenError = (message = 'Unauthorized') => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

const createBadRequestError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const createNotFoundError = (message) => {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
};

const toPlainConversation = (conversationDoc) => {
  if (!conversationDoc) return null;
  const raw =
    typeof conversationDoc.toObject === 'function'
      ? conversationDoc.toObject()
      : { ...conversationDoc };
  return {
    ...raw,
    _id: raw._id?.toString() || raw.id?.toString(),
    participants: Array.isArray(raw.participants) ? raw.participants : [],
    unreadCount:
      raw.unreadCount instanceof Map
        ? Object.fromEntries(raw.unreadCount.entries())
        : raw.unreadCount || {},
  };
};

const toPlainMessage = (messageDoc) => {
  if (!messageDoc) return null;
  const raw =
    typeof messageDoc.toObject === 'function'
      ? messageDoc.toObject()
      : { ...messageDoc };
  return {
    ...raw,
    _id: raw._id?.toString(),
  };
};

const deriveSenderType = (conversation, senderToken) => {
  const token = normalizeToken(senderToken);
  const workerTokens = uniqueTokens([conversation?.workerId, conversation?.workerEmail]);
  return workerTokens.includes(token) ? 'worker' : 'client';
};

const resolveSenderToken = ({ authUser, conversation, requestedSenderId }) => {
  const authTokens = getAuthTokens(authUser);
  const requested = normalizeToken(requestedSenderId);
  if (requested && authTokens.includes(requested)) return requested;

  const conversationTokens = getConversationTokens(conversation);
  const overlap = authTokens.find((token) => conversationTokens.includes(token));
  if (overlap) return overlap;

  if (authTokens.length > 0) return authTokens[0];
  return requested || '';
};

const resolveRecipientToken = ({ conversation, senderToken, requestedRecipientId }) => {
  const requested = normalizeToken(requestedRecipientId);
  const conversationTokens = getConversationTokens(conversation);
  if (requested && conversationTokens.includes(requested) && requested !== senderToken) {
    return requested;
  }

  const workerTokens = uniqueTokens([conversation.workerId, conversation.workerEmail]);
  const clientTokens = uniqueTokens([conversation.clientId, conversation.clientEmail]);

  if (workerTokens.includes(senderToken)) {
    return clientTokens[0] || '';
  }
  return workerTokens[0] || '';
};

const resolveParticipantName = async (token, senderType) => {
  if (!token) return senderType === 'worker' ? 'Worker' : 'Client';

  const tokenIsObjectId = isObjectIdString(token);
  const emailToken = token.includes('@') ? token : null;

  if (senderType === 'worker') {
    const userQuery = emailToken ? { email: emailToken } : tokenIsObjectId ? { _id: token } : null;
    if (userQuery) {
      const user = await User.findOne(userQuery).lean();
      if (user) {
        const full = `${(user.firstName || '').trim()} ${(user.lastName || '').trim()}`.trim();
        return full || user.email || 'Assigned Worker';
      }
    }
    return emailToken || 'Assigned Worker';
  }

  const clientQuery = emailToken
    ? { clientEmail: emailToken, isActive: true }
    : tokenIsObjectId
      ? { _id: token, isActive: true }
      : null;
  if (clientQuery) {
    const client = await Client.findOne(clientQuery).lean();
    if (client) {
      const full =
        `${(client.clientFirstName || '').trim()} ${(client.clientLastName || '').trim()}`.trim();
      return full || client.clientEmail || 'Client';
    }
  }

  return emailToken || 'Client';
};

const parseLegacyAppointmentId = (appointmentId) => {
  const raw = (appointmentId || '').toString().trim();
  if (!raw) return null;
  const index = raw.lastIndexOf('_');
  if (index <= 0) return null;

  const assignmentId = raw.slice(0, index);
  const parsedIndex = Number.parseInt(raw.slice(index + 1), 10);
  if (!Number.isInteger(parsedIndex)) return null;
  return { assignmentId, scheduleIndex: parsedIndex };
};

const resolveShiftWindowFromConversation = async (conversation) => {
  if (conversation?.shiftStartAt && conversation?.shiftEndAt) {
    return {
      startAt: new Date(conversation.shiftStartAt),
      endAt: new Date(conversation.shiftEndAt),
    };
  }

  const scheduleId = normalizeToken(conversation?.scheduleId || conversation?.appointmentId);
  let assignment = null;
  let scheduleItem = null;

  if (scheduleId && mongoose.Types.ObjectId.isValid(scheduleId)) {
    const { toSafeString } = require('../utils/security');
    assignment = await ClientAssignment.findOne({
      isActive: true,
      'schedule._id': toSafeString(scheduleId),
      ...(conversation?.organizationId ? { organizationId: toSafeString(conversation.organizationId) } : {}),
    }).lean();

    if (assignment) {
      const items = Array.isArray(assignment.schedule) ? assignment.schedule : [];
      scheduleItem = items.find((item) => item?._id?.toString() === scheduleId) || null;
    }
  }

  if (!assignment && conversation?.appointmentId) {
    const parsed = parseLegacyAppointmentId(conversation.appointmentId);
    if (parsed && mongoose.Types.ObjectId.isValid(parsed.assignmentId)) {
      assignment = await ClientAssignment.findOne({
        _id: parsed.assignmentId,
        isActive: true,
      }).lean();
      if (assignment) {
        const items = Array.isArray(assignment.schedule) ? assignment.schedule : [];
        scheduleItem = items[parsed.scheduleIndex] || null;
      }
    }
  }

  if (!assignment || !scheduleItem) {
    return { startAt: null, endAt: null };
  }

  const startAt = toShiftDateTime(scheduleItem.date, scheduleItem.startTime);
  const endAt = toShiftDateTime(scheduleItem.date, scheduleItem.endTime);

  if (startAt && endAt) {
    await MessageConversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          assignmentId: assignment._id.toString(),
          scheduleId: scheduleItem._id?.toString() || conversation.scheduleId || null,
          shiftStartAt: startAt,
          shiftEndAt: endAt,
        },
      }
    );
  }

  return { startAt, endAt };
};

const assertConversationParticipant = async ({ conversation, authUser }) => {
  if (!authUser) return;
  const authTokens = getAuthTokens(authUser);
  const conversationTokens = getConversationTokens(conversation);

  const hasAccess = authTokens.some((token) => conversationTokens.includes(token));
  if (!hasAccess && !isAdmin(authUser)) {
    throw createForbiddenError('You are not a participant in this conversation.');
  }
};

const provisionConversationsForUser = async ({ authUser }) => {
  const authEmail = normalizeEmail(authUser?.email);
  if (!authEmail) return;

  const { toSafeString } = require('../utils/security');
  const assignments = await ClientAssignment.find({
    isActive: true,
    $or: [{ userEmail: toSafeString(authEmail) }, { clientEmail: toSafeString(authEmail) }],
  }).lean();

  if (!assignments.length) return;

  const workerEmails = uniqueTokens(assignments.map((item) => item.userEmail));
  const clientEmails = uniqueTokens(assignments.map((item) => item.clientEmail));

  const [workers, clients] = await Promise.all([
    User.find({ email: { $in: workerEmails.map(toSafeString) } })
      .select({ _id: 1, email: 1 })
      .lean(),
    Client.find({ clientEmail: { $in: clientEmails.map(toSafeString) }, isActive: true })
      .select({ _id: 1, clientEmail: 1 })
      .lean(),
  ]);

  const workerByEmail = new Map(workers.map((item) => [normalizeEmail(item.email), item]));
  const clientByEmail = new Map(clients.map((item) => [normalizeEmail(item.clientEmail), item]));

  for (const assignment of assignments) {
    const schedules = Array.isArray(assignment.schedule) ? assignment.schedule : [];
    const workerEmail = normalizeEmail(assignment.userEmail);
    const clientEmail = normalizeEmail(assignment.clientEmail);
    const workerDoc = workerByEmail.get(workerEmail);
    const clientDoc = clientByEmail.get(clientEmail);

    for (let index = 0; index < schedules.length; index += 1) {
      const item = schedules[index];
      const scheduleId = item?._id?.toString() || `${assignment._id.toString()}_${index}`;
      const appointmentId = scheduleId;
      const startAt = toShiftDateTime(item?.date, item?.startTime);
      const endAt = toShiftDateTime(item?.date, item?.endTime);

      const clientId = clientDoc?._id?.toString() || assignment.clientId?.toString() || clientEmail;
      const workerId = workerDoc?._id?.toString() || workerEmail;
      const conversationId = `conv-${appointmentId}`;

      const participants = uniqueTokens([
        clientId,
        clientEmail,
        workerId,
        workerEmail,
      ]);

      await MessageConversation.updateOne(
        { _id: conversationId },
        {
          $setOnInsert: {
            _id: conversationId,
            createdAt: new Date(),
          },
          $set: {
            appointmentId,
            assignmentId: assignment._id.toString(),
            scheduleId,
            organizationId: assignment.organizationId?.toString() || null,
            clientId,
            clientEmail,
            workerId,
            workerEmail,
            participants,
            shiftStartAt: startAt,
            shiftEndAt: endAt,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }
  }
};

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
    authUser,
    senderName,
  } = params;

  if (!conversationId || !message) {
    throw createBadRequestError('conversationId and message are required');
  }

  const { toSafeString } = require('../utils/security');
  const conversationDoc = await MessageConversation.findById(toSafeString(conversationId));
  if (!conversationDoc) {
    throw createNotFoundError('Conversation not found');
  }
  const conversation = toPlainConversation(conversationDoc);

  await assertConversationParticipant({ conversation, authUser });

  const senderToken = resolveSenderToken({
    authUser,
    conversation,
    requestedSenderId: senderId,
  });
  if (!senderToken) {
    throw createForbiddenError('Unable to resolve authenticated sender.');
  }

  const recipientToken = resolveRecipientToken({
    conversation,
    senderToken,
    requestedRecipientId: recipientId,
  });
  if (!recipientToken || recipientToken === senderToken) {
    throw createBadRequestError('Unable to resolve recipient for this conversation.');
  }

  const shiftWindow = await resolveShiftWindowFromConversation(conversation);
  const chatWindow = buildChatWindow({
    startAt: shiftWindow.startAt,
    endAt: shiftWindow.endAt,
    now: new Date(),
  });
  if (ENFORCE_SHIFT_CHAT_WINDOW && !chatWindow.isOpen) {
    throw createForbiddenError(getChatWindowClosedMessage());
  }

  const encrypted = encryptMessage(message);
  const effectiveSenderType =
    normalizeToken(senderType) || deriveSenderType(conversation, senderToken);
  const resolvedSenderName =
    (senderName || '').toString().trim() ||
    (await resolveParticipantName(senderToken, effectiveSenderType));
  const sendTimestamp = timestamp ? new Date(timestamp) : new Date();

  const messageDoc = await SecureMessage.create({
    conversationId,
    senderId: senderToken,
    senderType: effectiveSenderType,
    senderName: resolvedSenderName,
    recipientId: recipientToken,
    message: encrypted.encrypted,
    iv: encrypted.iv,
    attachments: Array.isArray(attachments) ? attachments : [],
    timestamp: sendTimestamp,
    read: false,
    readAt: null,
    type: 'text',
  });

  const unreadCount = {
    ...(conversation.unreadCount || {}),
  };
  unreadCount[recipientToken] = Number(unreadCount[recipientToken] || 0) + 1;

  await MessageConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessage: message,
        lastMessageAt: sendTimestamp,
        unreadCount,
      },
    }
  );

  const plainMessage = toPlainMessage(messageDoc);
  return {
    ...plainMessage,
    message,
  };
};

/**
 * Get messages for conversation
 * @param {String} conversationId - Conversation ID
 * @param {Object} options - Query options
 * @param {Object} authUser - authenticated user
 * @returns {Array} Messages
 */
exports.getMessages = async (conversationId, options = {}, authUser = null) => {
  const { limit = 50, before } = options;
  const conversationDoc = await MessageConversation.findById(conversationId).lean();
  if (!conversationDoc) {
    throw createNotFoundError('Conversation not found');
  }

  await assertConversationParticipant({
    conversation: conversationDoc,
    authUser,
  });

  const query = { conversationId };
  if (before) {
    query.timestamp = { $lt: new Date(before) };
  }

  const rows = await SecureMessage.find(query)
    .sort({ timestamp: -1 })
    .limit(Math.max(1, Number(limit) || 50))
    .lean();

  return rows.map((row) => ({
    ...row,
    _id: row._id?.toString(),
    message: decryptMessage(row.message, row.iv),
  }));
};

/**
 * Mark message as read
 * @param {Object} params - Read parameters
 * @returns {Object} Updated message
 */
exports.markMessageAsRead = async (params) => {
  const { messageId, readBy, readAt } = params;
  const updated = await SecureMessage.findByIdAndUpdate(
    messageId,
    {
      $set: {
        read: true,
        readBy: readBy ? normalizeToken(readBy) : null,
        readAt: readAt || new Date(),
      },
    },
    { new: true }
  ).lean();

  if (!updated) {
    throw createNotFoundError('Message not found');
  }

  return {
    ...updated,
    _id: updated._id?.toString(),
    message: decryptMessage(updated.message, updated.iv),
  };
};

/**
 * Create or update conversation
 * @param {Object} params - Conversation parameters
 * @returns {Object} Conversation data
 */
exports.createConversation = async (params) => {
  const {
    appointmentId,
    assignmentId,
    scheduleId,
    clientId,
    clientEmail,
    workerId,
    workerEmail,
    organizationId,
    shiftStartAt,
    shiftEndAt,
  } = params;

  if (!appointmentId || !clientId || !workerId) {
    throw createBadRequestError('appointmentId, clientId, and workerId are required');
  }

  const conversationId = `conv-${appointmentId}`;
  const participants = uniqueTokens([clientId, clientEmail, workerId, workerEmail]);

  await MessageConversation.updateOne(
    { _id: conversationId },
    {
      $setOnInsert: {
        _id: conversationId,
        createdAt: new Date(),
      },
      $set: {
        appointmentId,
        assignmentId: assignmentId || null,
        scheduleId: scheduleId || appointmentId,
        organizationId: organizationId || null,
        clientId: normalizeToken(clientId),
        clientEmail: normalizeEmail(clientEmail),
        workerId: normalizeToken(workerId),
        workerEmail: normalizeEmail(workerEmail),
        participants,
        shiftStartAt: shiftStartAt || null,
        shiftEndAt: shiftEndAt || null,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const conversation = await MessageConversation.findById(conversationId).lean();
  return toPlainConversation(conversation);
};

/**
 * Get conversation
 * @param {String} conversationId - Conversation ID
 * @returns {Object} Conversation data
 */
exports.getConversation = async (conversationId) => {
  const conversation = await MessageConversation.findById(conversationId).lean();
  if (!conversation) {
    throw createNotFoundError('Conversation not found');
  }
  return toPlainConversation(conversation);
};

/**
 * Get conversations for user
 * @param {String} userId - User ID / email
 * @param {Object} options - control flags
 * @returns {Array} Conversations
 */
exports.getUserConversations = async (userId, options = {}) => {
  const { authUser = null, provisionFromAssignments = true } = options;
  if (provisionFromAssignments && authUser) {
    await provisionConversationsForUser({ authUser });
  }

  const userTokens = uniqueTokens([userId, ...(authUser ? getAuthTokens(authUser) : [])]);
  if (!userTokens.length) {
    return [];
  }

  const rows = await MessageConversation.find({
    participants: { $in: userTokens },
  })
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean();

  return rows.map((row) => {
    const shiftWindow = buildChatWindow({
      startAt: row.shiftStartAt,
      endAt: row.shiftEndAt,
      now: new Date(),
    });

    return {
      ...toPlainConversation(row),
      canMessage: shiftWindow.isOpen,
      chatWindowStatus: shiftWindow.status,
      chatStartAt: shiftWindow.chatStartAt,
      chatEndAt: shiftWindow.chatEndAt,
    };
  });
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
    authUser,
  } = params;

  if (!conversationId || !audioUrl) {
    throw createBadRequestError('conversationId and audioUrl are required');
  }

  const conversation = await MessageConversation.findById(conversationId).lean();
  if (!conversation) {
    throw createNotFoundError('Conversation not found');
  }
  await assertConversationParticipant({ conversation, authUser });

  const shiftWindow = await resolveShiftWindowFromConversation(conversation);
  const chatWindow = buildChatWindow({
    startAt: shiftWindow.startAt,
    endAt: shiftWindow.endAt,
    now: new Date(),
  });
  if (ENFORCE_SHIFT_CHAT_WINDOW && !chatWindow.isOpen) {
    throw createForbiddenError(getChatWindowClosedMessage());
  }

  const senderToken = resolveSenderToken({
    authUser,
    conversation,
    requestedSenderId: senderId,
  });
  const recipientToken = resolveRecipientToken({
    conversation,
    senderToken,
    requestedRecipientId: recipientId,
  });

  const encryptedPlaceholder = encryptMessage('[voice_message]');

  const messageDoc = await SecureMessage.create({
    conversationId,
    senderId: senderToken,
    senderType: normalizeToken(senderType) || deriveSenderType(conversation, senderToken),
    senderName: await resolveParticipantName(senderToken, senderType || 'worker'),
    recipientId: recipientToken,
    message: encryptedPlaceholder.encrypted,
    iv: encryptedPlaceholder.iv,
    attachments: [{ url: audioUrl, duration }],
    timestamp: timestamp || new Date(),
    read: false,
    type: 'voice',
  });

  const plain = toPlainMessage(messageDoc);
  return {
    ...plain,
    audioUrl,
    duration,
  };
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
    authUser,
  } = params;

  const attachment = {
    url: fileUrl,
    name: fileName,
    type: fileType,
    size: fileSize,
  };

  return exports.sendMessage({
    conversationId,
    senderId,
    senderType,
    recipientId,
    message: message || `Sent a file: ${fileName}`,
    attachments: [attachment],
    timestamp,
    authUser,
  });
};

/**
 * Get unread message count
 * @param {String} userId - User ID
 * @returns {Number} Unread count
 */
exports.getUnreadCount = async (userId) => {
  const token = normalizeToken(userId);
  if (!token) return 0;

  const conversations = await MessageConversation.find({
    participants: token,
  })
    .select({ unreadCount: 1 })
    .lean();

  return conversations.reduce((acc, conversation) => {
    const unread =
      conversation?.unreadCount instanceof Map
        ? conversation.unreadCount.get(token)
        : conversation?.unreadCount?.[token];
    return acc + Number(unread || 0);
  }, 0);
};

/**
 * Search messages
 * @param {String} conversationId - Conversation ID
 * @param {String} query - Search query
 * @param {Object} authUser - authenticated user
 * @returns {Array} Matching messages
 */
exports.searchMessages = async (conversationId, query, authUser = null) => {
  const messages = await exports.getMessages(conversationId, { limit: 500 }, authUser);
  const normalized = (query || '').toString().trim().toLowerCase();
  if (!normalized) return messages;

  return messages.filter((item) =>
    (item.message || '').toString().toLowerCase().includes(normalized)
  );
};

/**
 * Validate whether authenticated user can send in conversation.
 * Used by controllers before accepting send attempts.
 */
exports.assertCanSendInConversation = async (conversationId, authUser) => {
  const conversation = await MessageConversation.findById(conversationId).lean();
  if (!conversation) {
    throw createNotFoundError('Conversation not found');
  }

  await assertConversationParticipant({ conversation, authUser });

  const shiftWindow = await resolveShiftWindowFromConversation(conversation);
  const chatWindow = buildChatWindow({
    startAt: shiftWindow.startAt,
    endAt: shiftWindow.endAt,
    now: new Date(),
  });
  if (ENFORCE_SHIFT_CHAT_WINDOW && !chatWindow.isOpen) {
    throw createForbiddenError(getChatWindowClosedMessage());
  }

  return toPlainConversation(conversation);
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

  let encrypted = cipher.update((message || '').toString(), 'utf8', 'hex');
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
    return '[Encrypted message]';
  }
}
