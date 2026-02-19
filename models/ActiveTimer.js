const mongoose = require('mongoose');

const activeTimerSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  clientEmail: {
    type: String,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  organizationId: {
    type: String
  },
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'active_timers',
  toJSON: {
    transform: function (doc, ret) {
      // Transform _id to id (Flutter expects 'id' as string)
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      // Transform dates to ISO 8601 strings
      if (ret.startTime) ret.startTime = ret.startTime.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      
      return ret;
    }
  }
});

module.exports = mongoose.model('ActiveTimer', activeTimerSchema);
