const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  clientEmail: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
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
    type: String, // Ideally ObjectId ref 'Organization', keeping String for legacy compatibility
    required: true,
    index: true
  },
  ndisItem: {
    type: Object
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'clients', // Explicit collection name if needed, usually lowercase plural
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Indexes
clientSchema.index({ clientLastName: 1, clientFirstName: 1 });
clientSchema.index({ organizationId: 1 });
clientSchema.index({ clientEmail: 1 });

module.exports = mongoose.model('Client', clientSchema);
