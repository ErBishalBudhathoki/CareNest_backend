
const mongoose = require('mongoose');

const supportItemSchema = new mongoose.Schema({
  supportItemNumber: {
    type: String,
    required: true,
    unique: true
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

module.exports = mongoose.model('SupportItem', supportItemSchema);
