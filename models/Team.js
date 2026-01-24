const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  managerId: {
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
      requireApproval: Boolean,
      autoEscalationDelay: Number // minutes
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Team', teamSchema);
