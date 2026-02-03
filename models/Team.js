const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  managerId: { // Renaming to ownerId to match frontend? Frontend uses ownerId. I'll support both or stick to managerId and map it.
    // Keeping managerId but mapping in toJSON if needed.
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  settings: {
    timezone: String,
    workingHours: {
      start: String,
      end: String
    },
    emergencyProtocols: {
      requireApproval: { type: Boolean, default: false },
      autoEscalationDelay: Number // minutes
    }
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId, // Optional if teams are cross-org or handled differently
    index: true
  }
}, {
  timestamps: true,
  collection: 'teams',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      // Map managerId to ownerId for frontend compatibility
      ret.ownerId = ret.managerId ? ret.managerId.toString() : null;
      if (ret.managerId) ret.managerId = ret.managerId.toString();
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('Team', teamSchema);
