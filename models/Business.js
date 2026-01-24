const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
  businessName: {
    type: String,
    required: true
  },
  businessEmail: {
    type: String,
    required: true
  },
  businessPhone: {
    type: String
  },
  businessAddress: {
    type: String
  },
  businessCity: {
    type: String
  },
  businessState: {
    type: String
  },
  businessZip: {
    type: String
  },
  organizationId: {
    type: String,
    index: true
  },
  createdBy: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'businesses'
});

// Index to prevent duplicates within an organization
businessSchema.index({ businessName: 1, businessEmail: 1, organizationId: 1 }, { unique: true });

module.exports = mongoose.model('Business', businessSchema);
