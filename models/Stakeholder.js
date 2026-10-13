const mongoose = require('mongoose');

/**
 * A non-family stakeholder in a participant's care network (Phase 5):
 * plan manager, support coordinator, nominee or other.
 *
 * Permission shape mirrors the FamilyMember model so the same authorisation
 * pattern can be reused. Stakeholders are org-scoped and linked to clients via
 * `Client.stakeholders`.
 * See docs/NDIS_DEPTH_ROADMAP.md section 4.3.
 */

const stakeholderPermissionsSchema = new mongoose.Schema(
  {
    viewAppointments: { type: Boolean, default: false },
    viewDocuments: { type: Boolean, default: false },
    viewInvoices: { type: Boolean, default: false },
    editProfile: { type: Boolean, default: false },
    approveServices: { type: Boolean, default: false },
    manageStakeholders: { type: Boolean, default: false },
    viewMessages: { type: Boolean, default: false },
    sendMessages: { type: Boolean, default: false },
    viewServiceHistory: { type: Boolean, default: false },
    receiveNotifications: { type: Boolean, default: false },
  },
  { _id: false },
);

const stakeholderSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: ['plan_manager', 'support_coordinator', 'nominee', 'family', 'other'],
      default: 'other',
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '', index: true },
    phone: { type: String, trim: true, default: '' },
    company: { type: String, trim: true, default: '' },
    abn: { type: String, trim: true, default: '' },
    // Optional portal account linked to this stakeholder.
    linkedUserEmail: { type: String, trim: true, lowercase: true, default: '' },
    permissions: { type: stakeholderPermissionsSchema, default: () => ({}) },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'stakeholders',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

stakeholderSchema.index({ organizationId: 1, type: 1, name: 1 });

module.exports = mongoose.model('Stakeholder', stakeholderSchema);
