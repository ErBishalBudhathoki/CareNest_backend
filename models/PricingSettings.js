
const mongoose = require('mongoose');

const auditEntrySchema = new mongoose.Schema({
  action: String,
  performedBy: String,
  timestamp: Date,
  changes: String,
  reason: String
}, { _id: false });

const pricingSettingsSchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true
  },
  fallbackBaseRate: Number,
  isActive: {
    type: Boolean,
    default: true
  },
  version: {
    type: Number,
    default: 1
  },
  createdBy: String,
  updatedBy: String,
  auditTrail: [auditEntrySchema]
}, {
  timestamps: true,
  collection: 'pricing_settings'
});

module.exports = mongoose.model('PricingSettings', pricingSettingsSchema);
