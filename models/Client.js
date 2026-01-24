
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  zipCode: {
    type: String,
    required: true,
    trim: true
  },
  preferences: {
    communicationStyle: {
      type: String,
      enum: ['verbal', 'written', 'both'],
      default: 'verbal'
    },
    dietaryNeeds: [{
      type: String,
      trim: true
    }],
    specialRequirements: {
      type: String,
      trim: true
    },
    languages: [{
      type: String,
      trim: true
    }],
    preferredTimes: [{
      type: String,
      enum: ['morning', 'afternoon', 'evening']
    }]
  },
  careNotes: {
    type: String,
    trim: true
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  organizationId: {
    type: String,
    ref: 'Organization'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
clientSchema.index({ email: 1 });
clientSchema.index({ lastName: 1, firstName: 1 });
clientSchema.index({ organizationId: 1 });

module.exports = mongoose.model('Client', clientSchema);
