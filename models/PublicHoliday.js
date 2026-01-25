const mongoose = require('mongoose');

const publicHolidaySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  day: {
    type: String,
    required: true
  },
  organizationId: {
    type: String,
    default: null, // null for global/national holidays
    index: true
  },
  isCustom: {
    type: Boolean,
    default: false
  },
  state: {
    type: String, // e.g., 'NSW', 'VIC' for AU holidays
    default: null
  }
}, {
  timestamps: true,
  collection: 'holidays'
});

// Unique index for name + date + organizationId
publicHolidaySchema.index({ name: 1, date: 1, organizationId: 1 }, { unique: true });

module.exports = mongoose.model('PublicHoliday', publicHolidaySchema);
