const mongoose = require('mongoose');

const trainingProgressSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrainingModule',
    required: true
  },
  status: {
    type: String,
    enum: ['NotStarted', 'InProgress', 'Completed'],
    default: 'NotStarted'
  },
  progressPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  completedAt: {
    type: Date
  }
}, { timestamps: true });

// Ensure unique progress per user per module
trainingProgressSchema.index({ userId: 1, moduleId: 1 }, { unique: true });

module.exports = mongoose.model('TrainingProgress', trainingProgressSchema);
