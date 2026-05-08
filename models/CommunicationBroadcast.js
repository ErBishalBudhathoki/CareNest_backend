const mongoose = require('mongoose');

const communicationBroadcastSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  initiatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: { 
    type: String, 
    required: true
  },
  message: {
    type: String,
    required: true
  },
  targetGroup: {
    type: String,
    default: 'All Workers'
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  },
  acknowledgments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true,
  collection: 'communication_broadcasts',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.initiatorId) ret.initiatorId = ret.initiatorId.toString();
      if (ret.organizationId) ret.organizationId = ret.organizationId.toString();
      
      if (ret.acknowledgments && Array.isArray(ret.acknowledgments)) {
        ret.acknowledgments = ret.acknowledgments.map(id => id.toString());
      }
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('CommunicationBroadcast', communicationBroadcastSchema);
