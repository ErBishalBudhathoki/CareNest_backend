const mongoose = require('mongoose');

/**
 * A weekly SIL roster for a property. Entries reference Phase 1 `Shift`
 * documents for authoritative times; the roster never duplicates them.
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.4.
 */
const rosterEntrySchema = new mongoose.Schema(
  {
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
    clientIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    staffUserIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    shiftType: {
      type: String,
      enum: ['day', 'evening', 'active_night', 'sleepover', 'split'],
      default: 'day',
    },
    ratioRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SILRatioRule', default: null },
    requiredStaff: { type: Number, default: 1 },
    assignedStaff: { type: Number, default: 0 },
    compliance: {
      type: String,
      enum: ['ok', 'understaffed', 'overstaffed', 'ratio_breach'],
      default: 'ok',
    },
    // Denormalised times so the roster renders without a join.
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
  },
  { _id: false },
);

const silRosterSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SILProperty',
      required: true,
      index: true,
    },
    weekStarting: { type: Date, required: true },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    entries: { type: [rosterEntrySchema], default: [] },
    ratioWarnings: {
      type: [{ role: String, message: String }],
      default: [],
    },
    publishedAt: { type: Date, default: null },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'silRosters',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.propertyId) ret.propertyId = ret.propertyId.toString();
        if (ret.weekStarting) ret.weekStarting = ret.weekStarting.toISOString();
        if (ret.publishedAt) ret.publishedAt = ret.publishedAt.toISOString();
        if (Array.isArray(ret.entries)) {
          ret.entries = ret.entries.map((entry) => ({
            ...entry,
            shiftId: entry.shiftId ? entry.shiftId.toString() : null,
            ratioRuleId: entry.ratioRuleId ? entry.ratioRuleId.toString() : null,
            clientIds: (entry.clientIds || []).map((id) => id.toString()),
            staffUserIds: (entry.staffUserIds || []).map((id) => id.toString()),
            startTime: entry.startTime ? new Date(entry.startTime).toISOString() : null,
            endTime: entry.endTime ? new Date(entry.endTime).toISOString() : null,
          }));
        }
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

silRosterSchema.index({ organizationId: 1, propertyId: 1, weekStarting: 1 }, { unique: true });

module.exports = mongoose.model('SILRoster', silRosterSchema);
