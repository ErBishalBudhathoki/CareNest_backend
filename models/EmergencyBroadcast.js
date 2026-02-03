const mongoose = require('mongoose');

const emergencyBroadcastSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
    index: true
  },
  initiatorId: { // Frontend expects initiatorId
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: { // Frontend expects type
    type: String, 
    required: true
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'resolved', 'archived'],
    default: 'active'
  },
  acknowledgments: [{ // Matching frontend structure roughly (list of userIds who acked)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true,
  collection: 'emergency_broadcasts',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      // Transform ObjectId refs to strings
      if (ret.teamId) ret.teamId = ret.teamId.toString();
      if (ret.initiatorId) ret.initiatorId = ret.initiatorId.toString();
      
      // acknowledgments array of ObjectIds -> array of strings
      if (ret.acknowledgments && Array.isArray(ret.acknowledgments)) {
        ret.acknowledgments = ret.acknowledgments.map(id => id.toString());
      }
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('EmergencyBroadcast', emergencyBroadcastSchema);
