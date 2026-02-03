const mongoose = require('mongoose');

const trainingModuleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  contentUrl: {
    type: String
  },
  thumbnailUrl: {
    type: String
  },
  category: {
    type: String,
    default: 'General'
  },
  durationMinutes: {
    type: Number,
    default: 0
  },
  isRequired: {
    type: Boolean,
    default: false
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  roles: {
    type: [String], // Roles this module is assigned to
    default: []
  }
}, {
  timestamps: true,
  collection: 'trainingModules', // Matching legacy collection name
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('TrainingModule', trainingModuleSchema);
