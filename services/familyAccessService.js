/**
 * Family Access Service
 * Persistent family-member management with invite, activation, audit, and
 * admin/client lifecycle controls.
 */

const crypto = require('crypto');
const FamilyMember = require('../models/FamilyMember');
const User = require('../models/User');
const Client = require('../models/Client');
const auditService = require('./auditService');
const emailService = require('./emailService');
const clientAuthService = require('./clientAuthService');
const { admin } = require('../firebase-admin-config');

const ADMIN_ROLE_TAGS = new Set(['admin', 'superadmin', 'owner']);
const FAMILY_ROLE = 'family';

function normalizeRoleTags(...sources) {
  const tags = new Set();

  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const value of source) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized) tags.add(normalized);
      }
      continue;
    }

    const normalized = String(source || '').trim().toLowerCase();
    if (normalized) tags.add(normalized);
  }

  return [...tags];
}

function buildActorSnapshot(actorUser, actorRoles = []) {
  const roles = normalizeRoleTags(actorRoles, actorUser?.role, actorUser?.roles);
  return {
    userId: actorUser?._id || actorUser?.userId || actorUser?.id || null,
    email: String(actorUser?.email || '').trim().toLowerCase() || null,
    name:
      `${actorUser?.firstName || ''} ${actorUser?.lastName || ''}`.trim() ||
      actorUser?.name ||
      actorUser?.email ||
      'Unknown User',
    roles,
  };
}

function buildAuditEntry(action, actor, details = {}) {
  return {
    action,
    actor: buildActorSnapshot(actor),
    details,
    timestamp: new Date(),
  };
}

function buildDefaultPermissions(role) {
  switch (String(role || '').trim().toLowerCase()) {
    case 'guardian':
      return {
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
      };
    case 'viewer':
      return {
        viewAppointments: true,
        viewDocuments: false,
        viewInvoices: false,
        editProfile: false,
        approveServices: false,
        manageFamily: false,
        viewMessages: true,
        sendMessages: false,
        viewLocation: false,
        receiveNotifications: true,
      };
    default:
      return {
        viewAppointments: true,
        viewDocuments: true,
        viewInvoices: true,
        editProfile: false,
        approveServices: false,
        manageFamily: false,
        viewMessages: true,
        sendMessages: true,
        viewLocation: true,
        receiveNotifications: true,
      };
  }
}

function buildFamilyInviteHtml({
  firstName,
  clientName,
  inviterName,
  relationship,
  webResetLink,
  appResetLink,
}) {
  const safeFirstName = firstName || 'there';
  const safeClientName = clientName || 'your family member';
  const safeInviterName = inviterName || 'their care team';
  const safeRelationship = relationship || 'family';
  const primaryLink = webResetLink || appResetLink;
  const showAppShortcut = Boolean(appResetLink && appResetLink !== primaryLink);

  return `
    <div style="font-family: Arial, sans-serif; padding: 20px; text-align: left;">
      <h2 style="color: #4CAF50;">You’ve been invited to CareNest</h2>
      <p>Hi ${safeFirstName},</p>
      <p>${safeInviterName} invited you to help support ${safeClientName} as ${safeRelationship}.</p>
      <p>Set your password to activate your family access account.</p>
      <p style="margin: 24px 0;">
        <a href="${primaryLink}" style="display: inline-block; padding: 12px 18px; background: #4CAF50; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Set Password
        </a>
      </p>
      ${showAppShortcut ? `
      <p style="margin: 8px 0 16px;">
        <a href="${appResetLink}" style="display: inline-block; padding: 10px 16px; background: #1A3BA0; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
          Open in CareNest App
        </a>
      </p>` : ''}
      <p style="margin-top: 4px;">
        If buttons do not work, use this
        <a href="${primaryLink}" style="color:#1A3BA0; font-weight:600;">backup reset link</a>.
      </p>
      <p style="color: #777; font-size: 12px;">If you did not expect this invitation, you can ignore it.</p>
    </div>
  `;
}

function parseInviteName(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) {
    return { firstName: '', lastName: '' };
  }

  const segments = raw.split(' ');
  return {
    firstName: segments.shift() || '',
    lastName: segments.join(' '),
  };
}

function buildFamilyMemberDto(member) {
  if (!member) return null;
  const data = member.toJSON ? member.toJSON() : { ...member };
  return {
    ...data,
    name:
      data.name ||
      `${data.firstName || ''} ${data.lastName || ''}`.trim() ||
      data.email,
    updatedBy: data.updatedBy || data.invitedBy?.email || null,
  };
}

async function createOrUpdateFirebaseFamilyUser({
  normalizedEmail,
  displayName,
  temporaryPassword,
}) {
  try {
    const existing = await admin.auth().getUserByEmail(normalizedEmail);
    const updated = await admin.auth().updateUser(existing.uid, {
      disabled: false,
      password: temporaryPassword,
      displayName,
    });
    await admin.auth().revokeRefreshTokens(updated.uid);
    return updated;
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }

    return admin.auth().createUser({
      email: normalizedEmail,
      password: temporaryPassword,
      displayName,
      emailVerified: false,
      disabled: false,
    });
  }
}

async function buildResetLinks(normalizedEmail, options = {}) {
  const resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail);
  const resetParams = clientAuthService._extractResetParams(resetLink);
  const oobCode =
    resetParams?.oobCode || clientAuthService._extractResetOobCode(resetLink);
  const appResetLink = clientAuthService._buildAppResetLink(oobCode);
  const customWebResetLink = clientAuthService._buildCustomWebResetLink(
    oobCode,
    resetParams?.lang || 'en',
    options
  );
  const stableWebResetLink =
    customWebResetLink ||
    clientAuthService._buildWebResetLink(resetParams) ||
    resetLink;

  return {
    resetLink,
    oobCode,
    appResetLink,
    stableWebResetLink,
  };
}

async function pushAuditLog({
  action,
  entityId,
  actor,
  organizationId,
  oldValues = null,
  newValues = null,
  metadata = {},
}) {
  if (!actor?.email || !organizationId || !entityId) {
    return null;
  }

  try {
    return await auditService.createAuditLog({
      action,
      entityType: auditService.AUDIT_ENTITIES.USER,
      entityId: String(entityId),
      userEmail: actor.email,
      organizationId: String(organizationId),
      oldValues,
      newValues,
      metadata,
    });
  } catch (_) {
    return null;
  }
}

async function getClientAndActor({ actorUserId, actorRoles, clientId }) {
  const [actorUser, client] = await Promise.all([
    User.findById(actorUserId),
    Client.findById(clientId),
  ]);

  if (!actorUser) {
    const error = new Error('Authenticated user not found');
    error.statusCode = 401;
    throw error;
  }

  if (!client) {
    const error = new Error('Client not found');
    error.statusCode = 404;
    throw error;
  }

  const normalizedRoles = normalizeRoleTags(actorRoles, actorUser.role, actorUser.roles);
  const actorSnapshot = buildActorSnapshot(actorUser, normalizedRoles);

  if (
    normalizedRoles.some((role) => ADMIN_ROLE_TAGS.has(role)) &&
    String(actorUser.organizationId || '') === String(client.organizationId || '')
  ) {
    return { actorUser, actorSnapshot, client, accessLevel: 'admin' };
  }

  if (
    normalizedRoles.includes('client') &&
    !normalizedRoles.includes(FAMILY_ROLE) &&
    actorUser.clientId &&
    actorUser.clientId.toString() === String(client._id)
  ) {
    return { actorUser, actorSnapshot, client, accessLevel: 'client' };
  }

  if (normalizedRoles.includes(FAMILY_ROLE)) {
    const membership = await FamilyMember.findOne({
      userId: actorUser._id,
      clientId: client._id,
      status: 'active',
    });

    if (membership?.permissions?.manageFamily === true) {
      return {
        actorUser,
        actorSnapshot,
        client,
        membership,
        accessLevel: 'family-manager',
      };
    }
  }

  const error = new Error('You are not authorized to manage this family access');
  error.statusCode = 403;
  throw error;
}

exports.authorizeManagementAccess = async ({ actorUserId, actorRoles, clientId }) =>
  getClientAndActor({ actorUserId, actorRoles, clientId });

exports.inviteFamilyMember = async ({
  clientId,
  email,
  name,
  relationship,
  role,
  permissions,
  actor,
  client,
  options = {},
}) => {
  const normalizedEmail = clientAuthService._normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Family member email is required');
  }

  const normalizedRole = String(role || 'family').trim().toLowerCase();
  const effectivePermissions = permissions || buildDefaultPermissions(normalizedRole);
  const now = new Date();
  const { firstName, lastName } = parseInviteName(name);
  const invitationToken = crypto.randomBytes(24).toString('hex');
  const invitationExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const existingMember = await FamilyMember.findOne({
    clientId,
    email: normalizedEmail,
  });

  if (existingMember) {
    throw new Error(
      existingMember.status === 'inactive'
        ? 'Family member already exists for this client. Reactivate access instead.'
        : 'Family member has already been invited for this client.'
    );
  }

  let mongoUser = await User.findOne({ email: normalizedEmail });
  if (mongoUser && String(mongoUser.role || '').trim().toLowerCase() !== FAMILY_ROLE) {
    throw new Error('Email is already in use by a non-family account');
  }

  if (
    mongoUser?.clientId &&
    mongoUser.clientId.toString() !== String(clientId)
  ) {
    throw new Error('This family account is already linked to another client');
  }

  const displayName = `${firstName} ${lastName}`.trim() || normalizedEmail;
  const temporaryPassword = `Temp#${Math.random().toString(36).slice(-12)}A1`;
  const firebaseUser = await createOrUpdateFirebaseFamilyUser({
    normalizedEmail,
    displayName,
    temporaryPassword,
  });

  const userUpdate = {
    email: normalizedEmail,
    firstName,
    lastName,
    organizationId: client.organizationId,
    role: FAMILY_ROLE,
    roles: [FAMILY_ROLE],
    clientId: client._id,
    isActive: true,
    firebaseUid: firebaseUser.uid,
    firebaseSyncedAt: now,
    emailVerified: Boolean(firebaseUser.emailVerified),
    updatedAt: now,
  };

  if (mongoUser) {
    await User.updateOne(
      { _id: mongoUser._id },
      {
        $set: userUpdate,
        $unset: { password: '' },
      }
    );
    mongoUser = await User.findById(mongoUser._id);
  } else {
    mongoUser = await User.create({
      ...userUpdate,
      createdAt: now,
    });
  }

  if (!mongoUser) {
    throw new Error('Failed to create or update family account');
  }

  const auditEntry = buildAuditEntry('family_invited', actor, {
    invitedEmail: normalizedEmail,
    relationship,
    role: normalizedRole,
    status: 'pending',
    permissions: effectivePermissions,
  });

  const member = await FamilyMember.create({
    clientId,
    organizationId: client.organizationId,
    userId: mongoUser._id,
    email: normalizedEmail,
    firstName,
    lastName,
    relationship,
    role: normalizedRole,
    permissions: effectivePermissions,
    status: 'pending',
    activationPending: true,
    invitedAt: now,
    joinedAt: now,
    invitationToken,
    invitationExpiresAt,
    activationEmailSentAt: now,
    invitedBy: actor,
    updatedBy: actor.email,
    updatedByUserId: actor.userId,
    auditTrail: [auditEntry],
  });

  const resetLinks = await buildResetLinks(normalizedEmail, options);
  const emailSubject = 'Set up your CareNest family access';
  const emailHtml = buildFamilyInviteHtml({
    firstName,
    clientName:
      `${client.clientFirstName || ''} ${client.clientLastName || ''}`.trim() ||
      client.clientEmail,
    inviterName: actor.name,
    relationship,
    webResetLink: resetLinks.stableWebResetLink,
    appResetLink: resetLinks.appResetLink,
  });
  const emailResult = await emailService.sendEmail(
    normalizedEmail,
    emailSubject,
    emailHtml
  );

  await pushAuditLog({
    action: auditService.AUDIT_ACTIONS.CREATE,
    entityId: mongoUser._id,
    actor,
    organizationId: client.organizationId,
    newValues: {
      familyMemberId: member._id.toString(),
      clientId: client._id.toString(),
      role: FAMILY_ROLE,
      familyRole: normalizedRole,
      relationship,
      status: 'pending',
    },
    metadata: {
      invitedEmail: normalizedEmail,
      emailSent: Boolean(emailResult),
      invitedByUserId: actor.userId?.toString?.() || null,
      activationLinkFormat: resetLinks.appResetLink
        ? 'com.bishal.invoice://reset-password?mode=resetPassword&oobCode=...'
        : 'firebase-web-link',
    },
  });

  return {
    id: member._id.toString(),
    clientId: String(clientId),
    invitedBy: actor.email,
    email: normalizedEmail,
    name: displayName,
    relationship,
    role: normalizedRole,
    permissions: effectivePermissions,
    status: 'pending',
    invitedAt: now,
    expiresAt: invitationExpiresAt,
    token: invitationToken,
    emailSent: Boolean(emailResult),
  };
};

exports.getFamilyMembers = async (clientId) => {
  const members = await FamilyMember.find({ clientId }).sort({
    status: 1,
    createdAt: 1,
  });
  return members.map(buildFamilyMemberDto);
};

exports.updatePermissions = async ({ clientId, memberId, permissions, actor }) => {
  const member = await FamilyMember.findOne({ _id: memberId, clientId });
  if (!member) {
    throw new Error('Family member not found');
  }

  const oldPermissions = member.permissions?.toObject
    ? member.permissions.toObject()
    : member.permissions;

  member.permissions = {
    ...buildDefaultPermissions(member.role),
    ...(permissions || {}),
  };
  member.updatedAt = new Date();
  member.updatedBy = actor.email;
  member.updatedByUserId = actor.userId;
  member.auditTrail.push(
    buildAuditEntry('permissions_updated', actor, {
      oldPermissions,
      newPermissions: member.permissions,
    })
  );
  await member.save();

  await pushAuditLog({
    action: auditService.AUDIT_ACTIONS.UPDATE,
    entityId: member.userId,
    actor,
    organizationId: member.organizationId,
    oldValues: { permissions: oldPermissions },
    newValues: { permissions: member.permissions },
    metadata: {
      familyMemberId: member._id.toString(),
      clientId: member.clientId.toString(),
    },
  });

  return buildFamilyMemberDto(member);
};

exports.updateMemberStatus = async ({
  clientId,
  memberId,
  status,
  actor,
}) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!['active', 'inactive'].includes(normalizedStatus)) {
    throw new Error('Status must be active or inactive');
  }

  const member = await FamilyMember.findOne({ _id: memberId, clientId });
  if (!member) {
    throw new Error('Family member not found');
  }

  const user = await User.findById(member.userId);
  if (!user) {
    throw new Error('Linked family user not found');
  }

  const previousStatus = member.status;
  const now = new Date();

  if (user.firebaseUid) {
    await admin.auth().updateUser(user.firebaseUid, {
      disabled: normalizedStatus === 'inactive',
    });

    if (normalizedStatus === 'inactive') {
      await admin.auth().revokeRefreshTokens(user.firebaseUid);
    }
  }

  user.isActive = normalizedStatus === 'active';
  user.updatedAt = now;
  await user.save();

  member.status =
    normalizedStatus === 'active' && member.activatedAt == null
      ? 'pending'
      : normalizedStatus;
  member.activationPending = member.status === 'pending';
  member.updatedAt = now;
  member.updatedBy = actor.email;
  member.updatedByUserId = actor.userId;

  if (normalizedStatus === 'inactive') {
    member.deactivatedAt = now;
    member.deactivatedBy = actor;
  } else {
    member.reactivatedAt = now;
    member.reactivatedBy = actor;
    member.deactivatedAt = null;
    member.deactivatedBy = null;
  }

  member.auditTrail.push(
    buildAuditEntry(
      normalizedStatus === 'inactive'
        ? 'family_access_deactivated'
        : 'family_access_reactivated',
      actor,
      {
        previousStatus,
        newStatus: member.status,
      }
    )
  );
  await member.save();

  await pushAuditLog({
    action: auditService.AUDIT_ACTIONS.UPDATE,
    entityId: member.userId,
    actor,
    organizationId: member.organizationId,
    oldValues: { status: previousStatus, isActive: !user.isActive },
    newValues: { status: member.status, isActive: user.isActive },
    metadata: {
      familyMemberId: member._id.toString(),
      clientId: member.clientId.toString(),
    },
  });

  return buildFamilyMemberDto(member);
};

exports.markFamilyActivationComplete = async ({ user, now = new Date() }) => {
  if (!user || String(user.role || '').trim().toLowerCase() !== FAMILY_ROLE) {
    return { matched: 0, modified: 0 };
  }

  const member = await FamilyMember.findOne({
    userId: user._id,
  });

  if (!member) {
    return { matched: 0, modified: 0 };
  }

  const previousStatus = member.status;
  member.status = 'active';
  member.activationPending = false;
  member.activatedAt = member.activatedAt || now;
  member.updatedAt = now;
  member.updatedBy = String(user.email || '').trim().toLowerCase() || 'system';
  member.updatedByUserId = user._id;
  member.auditTrail.push(
    buildAuditEntry(
      'family_activation_completed',
      {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        roles: user.roles,
      },
      {
        previousStatus,
        newStatus: 'active',
      }
    )
  );
  await member.save();

  return { matched: 1, modified: 1 };
};

exports.getAccessLog = async (clientId, options = {}) => {
  const { limit = 100, startDate, endDate } = options;

  const members = await FamilyMember.find(
    { clientId },
    { auditTrail: 1, userId: 1, clientId: 1 }
  ).lean();

  let logs = members.flatMap((member) =>
    (member.auditTrail || []).map((entry) => ({
      id: entry?._id?.toString?.() || crypto.randomBytes(12).toString('hex'),
      clientId: String(member.clientId),
      userId: entry?.actor?.userId?.toString?.() || String(member.userId),
      action: entry.action,
      targetUserId: String(member.userId),
      details: entry.details || {},
      timestamp: entry.timestamp,
    }))
  );

  if (startDate) {
    const from = new Date(startDate);
    logs = logs.filter((log) => new Date(log.timestamp) >= from);
  }

  if (endDate) {
    const until = new Date(endDate);
    logs = logs.filter((log) => new Date(log.timestamp) <= until);
  }

  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return logs.slice(0, Number(limit) || 100);
};
