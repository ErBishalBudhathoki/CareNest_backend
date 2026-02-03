const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['member', 'admin', 'manager'],
    default: 'member'
  },
  status: { // Added to match frontend 'status' field
    type: String,
    enum: ['active', 'invited', 'inactive'],
    default: 'active'
  },
  availabilitySettings: {
    status: { type: String, default: 'available' }, // 'available', 'busy', 'offline'
    manualOverride: Boolean,
    manualUntil: Date
  },
  isEmergencyContact: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  collection: 'team_members',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.createdAt) ret.joinedAt = ret.createdAt.toISOString(); // Map createdAt to joinedAt
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Ensure a user is unique within a team
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
