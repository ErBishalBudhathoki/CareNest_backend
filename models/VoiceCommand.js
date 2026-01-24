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
    required: true
  },
  audioData: {
    type: String // path to stored audio file or base64 (if small)
  },
  nlpEntities: {
    intent: String,
    parameters: Map
  },
  language: {
    type: String,
    default: 'en-US'
  },
  success: {
    type: Boolean,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('VoiceCommand', voiceCommandSchema);
