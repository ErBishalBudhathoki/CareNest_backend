const mongoose = require('mongoose');

const certificationSchema = new mongoose.Schema({
  userId: {
    type: String,
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
    required: true,
    trim: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Expired'],
    default: 'Pending'
  },
  expiryDate: {
    type: Date,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  auditedBy: {
    type: String, // Admin User ID
    default: null
  },
  auditDate: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    trim: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Certification', certificationSchema);
