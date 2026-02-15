/**
 * Family Access Service
 * Handles family member management and permissions
 */

// In-memory storage for demo (use database in production)
const familyMembers = new Map();
const accessLogs = new Map();

/**
 * Invite family member
 * @param {Object} params - Invitation parameters
 * @returns {Object} Invitation data
 */
exports.inviteFamilyMember = async (params) => {
  const {
    clientId,
    invitedBy,
    email,
    name,
    relationship,
    role,
    permissions,
  } = params;

  const invitation = {
    _id: `inv-${Date.now()}`,
    clientId,
    invitedBy,
    email,
    name,
    relationship, // 'guardian', 'spouse', 'child', 'sibling', 'other'
    role, // 'guardian', 'family', 'viewer'
    permissions: permissions || getDefaultPermissions(role),
    status: 'pending',
    invitedAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    token: generateInvitationToken(),
  };

  // In production, send invitation email
  console.log('INVITATION SENT:', invitation);

  return invitation;
};

/**
 * Accept invitation
 * @param {Object} params - Acceptance parameters
 * @returns {Object} Family member data
 */
exports.acceptInvitation = async (params) => {
  const { token, userId } = params;

  // Find invitation by token (in production, query database)
  // For demo, create family member directly

  const member = {
    _id: `fam-${Date.now()}`,
    userId,
    clientId: params.clientId,
    name: params.name,
    email: params.email,
    relationship: params.relationship,
    role: params.role,
    permissions: params.permissions,
    status: 'active',
    joinedAt: new Date(),
  };

  if (!familyMembers.has(params.clientId)) {
    familyMembers.set(params.clientId, []);
  }
  familyMembers.get(params.clientId).push(member);

  // Log access
  logAccess({
    clientId: params.clientId,
    userId,
    action: 'family_member_joined',
    timestamp: new Date(),
  });

  return member;
};

/**
 * Get family members
 * @param {String} clientId - Client ID
 * @returns {Array} Family members
 */
exports.getFamilyMembers = async (clientId) => {
  return familyMembers.get(clientId) || [];
};

/**
 * Update family member permissions
 * @param {Object} params - Update parameters
 * @returns {Object} Updated member
 */
exports.updatePermissions = async (params) => {
  const { clientId, memberId, permissions, updatedBy } = params;

  const members = familyMembers.get(clientId) || [];
  const member = members.find((m) => m._id === memberId);

  if (!member) {
    throw new Error('Family member not found');
  }

  member.permissions = permissions;
  member.updatedAt = new Date();
  member.updatedBy = updatedBy;

  // Log access
  logAccess({
    clientId,
    userId: updatedBy,
    action: 'permissions_updated',
    targetUserId: memberId,
    details: { permissions },
    timestamp: new Date(),
  });

  return member;
};

/**
 * Remove family member
 * @param {Object} params - Removal parameters
 * @returns {Object} Result
 */
exports.removeFamilyMember = async (params) => {
  const { clientId, memberId, removedBy } = params;

  const members = familyMembers.get(clientId) || [];
  const index = members.findIndex((m) => m._id === memberId);

  if (index === -1) {
    throw new Error('Family member not found');
  }

  const removed = members.splice(index, 1)[0];
  familyMembers.set(clientId, members);

  // Log access
  logAccess({
    clientId,
    userId: removedBy,
    action: 'family_member_removed',
    targetUserId: memberId,
    timestamp: new Date(),
  });

  return { success: true, removed };
};

/**
 * Check permission
 * @param {Object} params - Permission check parameters
 * @returns {Boolean} Has permission
 */
exports.checkPermission = async (params) => {
  const { clientId, userId, permission } = params;

  const members = familyMembers.get(clientId) || [];
  const member = members.find((m) => m.userId === userId);

  if (!member || member.status !== 'active') {
    return false;
  }

  return member.permissions[permission] === true;
};

/**
 * Get access audit log
 * @param {String} clientId - Client ID
 * @param {Object} options - Query options
 * @returns {Array} Access logs
 */
exports.getAccessLog = async (clientId, options = {}) => {
  const { limit = 100, startDate, endDate } = options;

  let logs = accessLogs.get(clientId) || [];

  // Filter by date range
  if (startDate) {
    logs = logs.filter((log) => new Date(log.timestamp) >= new Date(startDate));
  }
  if (endDate) {
    logs = logs.filter((log) => new Date(log.timestamp) <= new Date(endDate));
  }

  // Sort by timestamp (newest first)
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Limit results
  return logs.slice(0, limit);
};

/**
 * Update notification preferences
 * @param {Object} params - Preference parameters
 * @returns {Object} Updated preferences
 */
exports.updateNotificationPreferences = async (params) => {
  const { clientId, memberId, preferences } = params;

  const members = familyMembers.get(clientId) || [];
  const member = members.find((m) => m._id === memberId);

  if (!member) {
    throw new Error('Family member not found');
  }

  member.notificationPreferences = {
    email: preferences.email !== undefined ? preferences.email : true,
    sms: preferences.sms !== undefined ? preferences.sms : false,
    push: preferences.push !== undefined ? preferences.push : true,
    appointmentReminders: preferences.appointmentReminders !== undefined ? preferences.appointmentReminders : true,
    statusUpdates: preferences.statusUpdates !== undefined ? preferences.statusUpdates : true,
    emergencyAlerts: preferences.emergencyAlerts !== undefined ? preferences.emergencyAlerts : true,
    serviceConfirmations: preferences.serviceConfirmations !== undefined ? preferences.serviceConfirmations : true,
    quietHours: preferences.quietHours || { start: '22:00', end: '08:00' },
  };

  return member.notificationPreferences;
};

/**
 * Share document with family
 * @param {Object} params - Share parameters
 * @returns {Object} Share result
 */
exports.shareDocument = async (params) => {
  const { clientId, documentId, sharedBy, sharedWith, permissions } = params;

  const share = {
    _id: `share-${Date.now()}`,
    clientId,
    documentId,
    sharedBy,
    sharedWith, // Array of member IDs
    permissions: permissions || ['view'], // 'view', 'download', 'edit'
    sharedAt: new Date(),
    expiresAt: params.expiresAt || null,
  };

  // Log access
  logAccess({
    clientId,
    userId: sharedBy,
    action: 'document_shared',
    details: { documentId, sharedWith },
    timestamp: new Date(),
  });

  return share;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get default permissions for role
 * @param {String} role - Role name
 * @returns {Object} Permissions
 */
function getDefaultPermissions(role) {
  const permissions = {
    guardian: {
      viewAppointments: true,
      viewDocuments: true,
      viewInvoices: true,
      editProfile: true,
      approveServices: true,
      manageFamily: true,
      viewMessages: true,
      sendMessages: true,
      viewLocation: true,
      receiveNotifications: true,
    },
    family: {
      viewAppointments: true,
      viewDocuments: false,
      viewInvoices: false,
      editProfile: false,
      approveServices: false,
      manageFamily: false,
      viewMessages: true,
      sendMessages: true,
      viewLocation: true,
      receiveNotifications: true,
    },
    viewer: {
      viewAppointments: true,
      viewDocuments: false,
      viewInvoices: false,
      editProfile: false,
      approveServices: false,
      manageFamily: false,
      viewMessages: false,
      sendMessages: false,
      viewLocation: false,
      receiveNotifications: false,
    },
  };

  return permissions[role] || permissions.viewer;
}

/**
 * Generate invitation token
 * @returns {String} Token
 */
function generateInvitationToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

/**
 * Log access activity
 * @param {Object} logEntry - Log entry data
 */
function logAccess(logEntry) {
  const { clientId } = logEntry;

  if (!accessLogs.has(clientId)) {
    accessLogs.set(clientId, []);
  }

  accessLogs.get(clientId).push({
    _id: `log-${Date.now()}`,
    ...logEntry,
  });

  // Keep only last 1000 logs per client
  const logs = accessLogs.get(clientId);
  if (logs.length > 1000) {
    accessLogs.set(clientId, logs.slice(-1000));
  }
}

