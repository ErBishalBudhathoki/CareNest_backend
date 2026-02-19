
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
    required: true,
    index: true
  },
  // Boolean Flags
  autoUpdatePricing: { type: Boolean, default: false },
  enablePriceValidation: { type: Boolean, default: true },
  requireApprovalForChanges: { type: Boolean, default: false },
  enableBulkOperations: { type: Boolean, default: false },
  enablePriceHistory: { type: Boolean, default: true },
  enableNotifications: { type: Boolean, default: true },

  // Configuration
  defaultCurrency: { type: String, default: 'AUD', maxlength: 3 },
  pricingModel: { type: String, default: 'Standard' },
  roundingMethod: { type: String, default: 'Round Half Up' },
  taxCalculation: { type: String, enum: ['GST Inclusive', 'GST Exclusive'], default: 'GST Exclusive' },
  
  // Numeric Settings
  fallbackBaseRate: { type: Number },
  defaultMarkup: { type: Number, default: 0 },
  maxPriceVariation: { type: Number, default: 10 },
  priceHistoryRetention: { type: Number, default: 365 }, // Days
  bulkOperationLimit: { type: Number, default: 100 },

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
  collection: 'pricing_settings',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

module.exports = mongoose.model('PricingSettings', pricingSettingsSchema);
