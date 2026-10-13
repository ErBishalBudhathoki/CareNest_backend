const mongoose = require('mongoose');

/**
 * A staffing-ratio rule used to compute required staff for SIL shifts.
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.3.
 */
const silRatioRuleSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    ratio: {
      staff: { type: Number, default: 1 },
      participants: { type: Number, default: 1 },
    },
    shiftType: {
      type: String,
      enum: ['day', 'evening', 'active_night', 'sleepover', 'split'],
      default: 'day',
    },
    appliesTo: {
      propertyIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      silDesignCategories: { type: [String], default: [] },
    },
    minParticipants: { type: Number, default: 1 },
    maxParticipants: { type: Number, default: 0 }, // 0 = unbounded
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    collection: 'silRatioRules',
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        if (ret.appliesTo && Array.isArray(ret.appliesTo.propertyIds)) {
          ret.appliesTo.propertyIds = ret.appliesTo.propertyIds.map((id) => id.toString());
        }
        if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

silRatioRuleSchema.index({ organizationId: 1, shiftType: 1, isActive: 1 });

module.exports = mongoose.model('SILRatioRule', silRatioRuleSchema);
