const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
  businessName: {
    type: String,
    required: true,
    trim: true
  },
  businessEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  businessPhone: {
    type: String,
    trim: true
  },
  businessAddress: {
    type: String,
    trim: true
  },
  businessCity: {
    type: String,
    trim: true
  },
  businessState: {
    type: String,
    trim: true
  },
  businessZip: {
    type: String,
    trim: true
  },
  organizationId: {
    type: String, // Or ObjectId if ref, keeping String for legacy
    required: true,
    index: true
  },
  createdBy: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'businesses',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Index to prevent duplicates within an organization
businessSchema.index({ businessName: 1, businessEmail: 1, organizationId: 1 }, { unique: true });

module.exports = mongoose.model('Business', businessSchema);
