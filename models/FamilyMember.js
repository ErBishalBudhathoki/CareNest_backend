const mongoose = require('mongoose');

const actorSnapshotSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    roles: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const familyPermissionsSchema = new mongoose.Schema(
  {
    viewAppointments: { type: Boolean, default: true },
    viewDocuments: { type: Boolean, default: false },
    viewInvoices: { type: Boolean, default: false },
    editProfile: { type: Boolean, default: false },
    approveServices: { type: Boolean, default: false },
    manageFamily: { type: Boolean, default: false },
    viewMessages: { type: Boolean, default: true },
    sendMessages: { type: Boolean, default: false },
    viewLocation: { type: Boolean, default: false },
    receiveNotifications: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationPreferencesSchema = new mongoose.Schema(
  {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: true },
    appointmentReminders: { type: Boolean, default: true },
    statusUpdates: { type: Boolean, default: true },
    emergencyAlerts: { type: Boolean, default: true },
    serviceConfirmations: { type: Boolean, default: true },
    quietHours: {
      start: { type: String, default: '22:00' },
      end: { type: String, default: '08:00' },
    },
  },
  { _id: false }
);

const familyAuditEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
    },
    actor: {
      type: actorSnapshotSchema,
      required: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const familyMemberSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
    relationship: {
      type: String,
      required: true,
      trim: true,
      default: 'family',
    },
    role: {
      type: String,
      required: true,
      enum: ['guardian', 'family', 'viewer'],
      default: 'family',
    },
    permissions: {
      type: familyPermissionsSchema,
      default: () => ({}),
    },
    notificationPreferences: {
      type: notificationPreferencesSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'active', 'inactive'],
      default: 'pending',
      index: true,
    },
    activationPending: {
      type: Boolean,
      default: true,
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    invitationToken: {
      type: String,
      default: null,
    },
    invitationExpiresAt: {
      type: Date,
      default: null,
    },
    activationEmailSentAt: {
      type: Date,
      default: null,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    deactivatedAt: {
      type: Date,
      default: null,
    },
    deactivatedBy: {
      type: actorSnapshotSchema,
      default: null,
    },
    reactivatedAt: {
      type: Date,
      default: null,
    },
    reactivatedBy: {
      type: actorSnapshotSchema,
      default: null,
    },
    invitedBy: {
      type: actorSnapshotSchema,
      required: true,
    },
    updatedBy: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    updatedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    auditTrail: {
      type: [familyAuditEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'familymembers',
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id.toString();
        ret.userId = ret.userId?.toString?.() || ret.userId;
        ret.clientId = ret.clientId?.toString?.() || ret.clientId;
        ret.name = `${ret.firstName || ''} ${ret.lastName || ''}`.trim();

        if (ret.invitedBy?.userId?.toString) {
          ret.invitedBy.userId = ret.invitedBy.userId.toString();
        }
        if (ret.deactivatedBy?.userId?.toString) {
          ret.deactivatedBy.userId = ret.deactivatedBy.userId.toString();
        }
        if (ret.reactivatedBy?.userId?.toString) {
          ret.reactivatedBy.userId = ret.reactivatedBy.userId.toString();
        }

        if (Array.isArray(ret.auditTrail)) {
          ret.auditTrail = ret.auditTrail.map((entry) => ({
            ...entry,
            id: entry?._id?.toString?.() || entry?._id || undefined,
            actor: entry?.actor
              ? {
                  ...entry.actor,
                  userId: entry.actor.userId?.toString?.() || entry.actor.userId,
                }
              : null,
          }));
        }

        delete ret._id;
        delete ret.__v;
        delete ret.firstName;
        delete ret.lastName;
        delete ret.invitationToken;
        delete ret.invitationExpiresAt;
        return ret;
      },
    },
  }
);

familyMemberSchema.index({ clientId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('FamilyMember', familyMemberSchema);
