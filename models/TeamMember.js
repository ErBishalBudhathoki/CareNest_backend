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
  timestamps: true
});

// Ensure a user is unique within a team
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
