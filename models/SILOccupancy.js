const mongoose = require('mongoose');

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
