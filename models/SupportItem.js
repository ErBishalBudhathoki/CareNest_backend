
const mongoose = require('mongoose');

const supportItemSchema = new mongoose.Schema({
  // Milestone 7.2: Removed standalone unique constraint so historical and future
  // price guide versions of the same NDIS support item number can coexist with effective dates.
  supportItemNumber: {
    type: String,
    required: true,
    index: true
  },
  // Milestone 7.2: Price guide version identifier (e.g. '2024-25', '2025-26', 'current')
  priceGuideVersion: {
    type: String,
    default: 'current',
    index: true
  },
  supportItemName: String,
  price: Number,
  priceCaps: mongoose.Schema.Types.Mixed, // Stores price caps: { national, remote, veryRemote, standard: { ... }, ... }
  description: String,
  unit: String,
  // True when the item comes from the NDIS legacy catalogue (has a real
  // expiry date instead of 9999-12-31). Surfaced in the app with an
  // "expires <date>" badge; expired items are blocked at invoice time.
  isLegacy: {
    type: Boolean,
    default: false
  },
  supportCategoryNumberPACE: String,
  supportCategoryNamePACE: String,
  supportType: String,
  startDate: Date,
  endDate: Date,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'support_items'
});

// Milestone 7.2: Effective-dated compound indexes to query the applicable price guide rate by date of service
supportItemSchema.index({ supportItemNumber: 1, startDate: 1 });
supportItemSchema.index({ supportItemNumber: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('SupportItem', supportItemSchema);
