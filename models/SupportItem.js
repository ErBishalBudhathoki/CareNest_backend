
const mongoose = require('mongoose');

const supportItemSchema = new mongoose.Schema({
  supportItemNumber: {
    type: String,
    required: true,
    unique: true
  },
  supportItemName: String,
  price: Number,
  priceCaps: mongoose.Schema.Types.Mixed, // Stores regional price caps (e.g. { standard: { NSW: 100 } })
  description: String,
  unit: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'support_items'
});

module.exports = mongoose.model('SupportItem', supportItemSchema);
