const mongoose = require('mongoose');

const emergencyBroadcastSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  priorityLevel: {
    type: String,
    enum: ['high', 'critical', 'emergency'],
    required: true
  },
  recipients: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['pending', 'sent', 'delivered', 'read', 'acknowledged'], default: 'pending' },
    deliveredAt: Date,
    acknowledgedAt: Date
  }],
  deliveryStatus: {
    total: Number,
    sent: Number,
    acknowledged: Number
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('EmergencyBroadcast', emergencyBroadcastSchema);
