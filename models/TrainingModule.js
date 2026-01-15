const mongoose = require('mongoose');

const trainingModuleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  contentType: {
    type: String,
    enum: ['Video', 'Text', 'Link'],
    required: true
  },
  contentUrl: {
    type: String, // URL for video/link
    required: false
  },
  contentText: {
    type: String, // For text content
    required: false
  },
  durationMinutes: {
    type: Number,
    required: true
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('TrainingModule', trainingModuleSchema);
