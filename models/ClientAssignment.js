const mongoose = require('mongoose');

const scheduleItemSchema = new mongoose.Schema({
  date: {
    type: String, // YYYY-MM-DD
    required: true
  },
  startTime: {
    type: String, // HH:MM
    required: true
  },
  endTime: {
    type: String, // HH:MM
    required: true
  },
  break: {
    type: String,
    default: '0'
  },
  highIntensity: {
    type: Boolean,
    default: false
  },
  ndisItem: {
    type: mongoose.Schema.Types.Mixed, // Flexible NDIS item data
    default: null
  }
});

const clientAssignmentSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  clientEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  organizationId: {
    type: String, // Or ObjectId, legacy seems to be String
    required: true,
    index: true
  },
  schedule: [scheduleItemSchema],
  assignedNdisItemNumber: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'clientAssignments',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;

      if (ret.clientId) ret.clientId = ret.clientId.toString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Indexes
clientAssignmentSchema.index({ userEmail: 1, clientEmail: 1, isActive: 1 });

module.exports = mongoose.model('ClientAssignment', clientAssignmentSchema);
