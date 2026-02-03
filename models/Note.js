const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true
  },
  clientEmail: {
    type: String,
    required: true,
    index: true
  },
  notes: {
    type: String,
    required: true,
    maxlength: 5000
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'notes',
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

// Compound indexes for common queries
noteSchema.index({ userEmail: 1, clientEmail: 1, createdAt: -1 });
noteSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model('Note', noteSchema);
