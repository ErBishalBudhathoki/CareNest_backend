const mongoose = require('mongoose');

const mmmLocationSchema = new mongoose.Schema({
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
  locationName: {
    type: String
  },
  state: {
    type: String
  }
}, {
  timestamps: true
});

// Note: unique:true on postcode already creates an index

module.exports = mongoose.model('MmmLocation', mmmLocationSchema, 'mmmLocations');
