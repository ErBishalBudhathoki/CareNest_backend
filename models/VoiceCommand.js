const mongoose = require('mongoose');

const voiceCommandSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  commandText: {
    type: String,
    required: true,
    trim: true,
    maxLength: 1000 // Reasonable limit
  },
  audioData: {
    type: String, // path to stored audio file or base64 (if small)
    select: false // Don't return heavy audio data by default
  },
  nlpEntities: {
    intent: { type: String, trim: true },
    parameters: { type: Map, of: mongoose.Schema.Types.Mixed }, // Flexible parameters
    confidence: { type: Number, min: 0, max: 1 }
  },
  language: {
    type: String,
    default: 'en-US',
    trim: true
  },
  success: {
    type: Boolean,
    required: true,
    default: false
  },
  processingTime: Number, // milliseconds
  errorMessage: String
}, {
  timestamps: true,
  collection: 'voicecommands',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      // Transform dates
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

// Indexes
voiceCommandSchema.index({ userId: 1, createdAt: -1 });
voiceCommandSchema.index({ 'nlpEntities.intent': 1 });

module.exports = mongoose.model('VoiceCommand', voiceCommandSchema);
