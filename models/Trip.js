const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null
  },
  date: {
    type: Date,
    required: true
  },
  startLocation: {
    type: String,
    required: true
  },
  endLocation: {
    type: String,
    required: true
  },
  distance: {
    type: Number,
    required: true
  },
  tripType: {
    type: String,
    enum: ['BETWEEN_CLIENTS', 'WITH_CLIENT', 'COMMUTE'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  adminApprovalStatus: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  isReimbursable: {
    type: Boolean,
    default: false
  },
  isBillable: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

tripSchema.index({ userId: 1, date: -1 });
tripSchema.index({ organizationId: 1, date: -1 });
tripSchema.index({ status: 1 });
tripSchema.index({ isReimbursable: 1 });

module.exports = mongoose.model('Trip', tripSchema);
