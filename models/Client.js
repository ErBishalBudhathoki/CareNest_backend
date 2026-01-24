
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  clientEmail: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  clientFirstName: {
    type: String,
    required: true,
    trim: true
  },
  clientLastName: {
    type: String,
    required: true,
    trim: true
  },
  clientPhone: {
    type: String,
    required: true,
    trim: true
  },
  clientAddress: {
    type: String,
    required: true,
    trim: true
  },
  clientCity: {
    type: String,
    required: true,
    trim: true
  },
  clientState: {
    type: String,
    required: true,
    trim: true
  },
  clientZip: {
    type: String,
    required: true,
    trim: true
  },
  businessName: {
    type: String,
    trim: true
  },
  preferences: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  careNotes: {
    type: String,
    trim: true,
    default: ""
  },
  emergencyContact: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  medicalConditions: {
    type: [String],
    default: []
  },
  riskAssessment: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  organizationId: {
    type: String,
    ref: 'Organization'
  },
  ndisItem: {
    type: Object
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
clientSchema.index({ clientEmail: 1 });
clientSchema.index({ clientLastName: 1, clientFirstName: 1 });
clientSchema.index({ organizationId: 1 });

module.exports = mongoose.model('Client', clientSchema);
