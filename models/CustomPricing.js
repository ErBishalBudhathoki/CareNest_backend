
const mongoose = require('mongoose');

const auditEntrySchema = new mongoose.Schema({
  action: String,
  performedBy: String,
  timestamp: Date,
  changes: String,
  reason: String
}, { _id: false });

const customPricingSchema = new mongoose.Schema({
  clientId: {
    type: String, // Can be string or ObjectId depending on how it's stored, keeping it loose for now or String if mixed
    ref: 'Client'
  },
  organizationId: {
    type: String,
    required: true
  },
  supportItemNumber: String,
  supportItemName: String,
  pricingType: {
    type: String,
    enum: ['fixed', 'multiplier']
  },
  customPrice: Number,
  multiplier: Number,
  clientSpecific: {
    type: Boolean,
    default: false
  },
  ndisCompliant: {
    type: Boolean,
    default: true
  },
  exceedsNdisCap: {
    type: Boolean,
    default: false
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  effectiveDate: Date,
  expiryDate: Date,
  
  createdBy: String,
  updatedBy: String,
  deletedBy: String,
  deletedAt: Date,
  
  approvedBy: String,
  approvedAt: Date,
  rejectedBy: String,
  rejectedAt: Date,
  approvalNotes: String,
  
  isActive: {
    type: Boolean,
    default: true
  },
  version: {
    type: Number,
    default: 1
  },
  auditTrail: [auditEntrySchema]
}, {
  timestamps: true,
  collection: 'custom_pricing' // Matches existing collection usage
});

module.exports = mongoose.model('CustomPricing', customPricingSchema);
