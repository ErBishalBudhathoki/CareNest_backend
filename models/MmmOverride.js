const mongoose = require('mongoose');

const mmmOverrideSchema = new mongoose.Schema({
  postcode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  mmm: {
    type: Number,
    required: true,
    min: 1,
    max: 7
  },
  notes: {
    type: String
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

mmmOverrideSchema.index({ postcode: 1 });

module.exports = mongoose.model('MmmOverride', mmmOverrideSchema, 'mmmOverrides');
