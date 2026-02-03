const mongoose = require('mongoose');

const certificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  issuer: {
    type: String,
    trim: true
  },
  issueDate: {
    type: Date
  },
  expiryDate: {
    type: Date
  },
  fileUrl: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'pending_approval', 'rejected'],
    default: 'pending_approval'
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  collection: 'certifications',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      if (ret.issueDate) ret.issueDate = ret.issueDate.toISOString();
      if (ret.expiryDate) ret.expiryDate = ret.expiryDate.toISOString();
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      return ret;
    }
  }
});

module.exports = mongoose.model('Certification', certificationSchema);
