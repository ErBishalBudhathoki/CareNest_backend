const mongoose = require('mongoose');

/**
 * A SIL property (house) where supported independent living is delivered.
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.1.
 */
const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, trim: true },
    label: { type: String, default: '', trim: true },
    vacant: { type: Boolean, default: true },
    accessibility: { type: [String], default: [] },
  },
  { _id: false },
);

const silPropertySchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    reference: { type: String, default: '', trim: true },
    address: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      suburb: { type: String, default: '' },
      state: { type: String, default: '' },
      postcode: { type: String, default: '' },
      country: { type: String, default: 'Australia' },
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    propertyType: {
      type: String,
      enum: ['house', 'townhouse', 'apartment', 'group_home', 'other'],
      default: 'house',
    },
    silDesignCategory: {
      type: String,
      enum: [
        'basic',
        'basic_vacancy',
        'improved_liveability',
        'robust',
        'fully_accessible',
        'high_physical_support',
        'high_intensity_ventilation',
        'custom',
      ],
      default: 'basic',
    },
    rooms: { type: [roomSchema], default: [] },
    bedrooms: { type: Number, default: 0 },
    amenities: { type: [String], default: [] },
    maxOccupancy: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'silProperties',
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

silPropertySchema.index({ organizationId: 1, active: 1, name: 1 });
silPropertySchema.index({ location: '2dsphere' });

module.exports = mongoose.model('SILProperty', silPropertySchema);
