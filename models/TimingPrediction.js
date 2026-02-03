const mongoose = require('mongoose');

const timingPredictionSchema = new mongoose.Schema({
  notificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NotificationHistory', 
    required: true,
    index: true
  },
  predictedTime: {
    type: Date,
    required: true
  },
  confidenceScore: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  featureImportance: {
    type: Map,
    of: Number,
    default: {}
  },
  alternativeTimes: [{
    time: Date,
    score: Number
  }],
  modelVersion: {
    type: String,
    required: true
  }
}, {
  timestamps: true,
  collection: 'timing_predictions',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.notificationId) ret.notificationId = ret.notificationId.toString();
      if (ret.predictedTime) ret.predictedTime = ret.predictedTime.toISOString();
      
      if (ret.alternativeTimes) {
        ret.alternativeTimes = ret.alternativeTimes.map(at => ({
          ...at,
          time: at.time ? at.time.toISOString() : null,
          _id: undefined // Remove subdoc id
        }));
      }
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('TimingPrediction', timingPredictionSchema);
