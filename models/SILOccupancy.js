const mongoose = require('mongoose');

/**
 * Absence subdocument tracking hospital stays, holidays, and temporary leaves (Milestone 2.1).
 * Under NDIA rules, hospital leave can be claimed for up to 28 consecutive days.
 */
const silAbsenceSchema = new mongoose.Schema(
  {
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null }, // null indicates ongoing absence
    reason: {
      type: String,
      enum: ['hospital', 'family_leave', 'holiday', 'transition', 'other'],
      default: 'hospital',
    },
    notes: { type: String, default: '' },
    maxClaimableDays: { type: Number, default: 28 }, // 28 days for hospital under NDIS guidelines
    claimedDays: { type: Number, default: 0 },
    createdBy: { type: String, default: '' },
  },
  { _id: true, timestamps: true },
);

/**
 * A participant's residence at a SIL property for a period.
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.2.
 *
 * Invariant: at most one `active` occupancy per (propertyId, roomId) at a time.
 * Enforced in the service layer (create/update) plus a partial unique index.
 */
const silOccupancySchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SILProperty',
      required: true,
      index: true,
    },
    roomId: { type: String, required: true, trim: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['active', 'pending', 'ended', 'cancelled'],
      default: 'active',
      index: true,
    },
    fundingType: {
      type: String,
      enum: ['ndia_managed', 'plan_managed', 'self_managed'],
      default: 'plan_managed',
    },
    vacatedReason: { type: String, default: '' },
    // Milestone 2.1: Temporary absences (hospital, holidays, family leave)
    absences: { type: [silAbsenceSchema], default: [] },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'silOccupancies',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.propertyId) ret.propertyId = ret.propertyId.toString();
        if (ret.clientId) ret.clientId = ret.clientId.toString();
        if (ret.startDate) ret.startDate = ret.startDate.toISOString();
        if (ret.endDate) ret.endDate = ret.endDate.toISOString();
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        // Milestone 2.1: Ensure serialized absence IDs and dates are clean ISO strings
        if (Array.isArray(ret.absences)) {
          ret.absences = ret.absences.map((abs) => {
            if (abs && abs._id) {
              abs.id = abs._id.toString();
              delete abs._id;
            }
            if (abs && abs.startDate instanceof Date) abs.startDate = abs.startDate.toISOString();
            if (abs && abs.endDate instanceof Date) abs.endDate = abs.endDate.toISOString();
            return abs;
          });
        }
        return ret;
      },
    },
  },
);

silOccupancySchema.index({ organizationId: 1, propertyId: 1, status: 1 });
silOccupancySchema.index({ organizationId: 1, clientId: 1, status: 1 });
// One active occupancy per room.
silOccupancySchema.index(
  { organizationId: 1, propertyId: 1, roomId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'uniq_active_occupancy_per_room',
  },
);

module.exports = mongoose.model('SILOccupancy', silOccupancySchema);
