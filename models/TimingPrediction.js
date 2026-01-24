const mongoose = require('mongoose');

const timingPredictionSchema = new mongoose.Schema({
  notificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NotificationHistory', // Assuming this links to the history/notification record
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
  timestamps: true
});

module.exports = mongoose.model('TimingPrediction', timingPredictionSchema);
