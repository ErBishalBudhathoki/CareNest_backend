const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  createdBy: {
    type: String, // Email of the creator
    required: true
  },
  leaveType: {
    type: String,
    required: true,
    enum: ['annual', 'sick', 'personal', 'longService']
  },
  startDate: {
    type: Date,
    required: true,
    index: true
  },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        return v >= this.startDate;
      },
      message: 'End date must be after start date'
    }
  },
  totalHours: {
    type: Number,
    required: true,
    min: 0.1,
    max: 168 // Max hours in a week
  },
  reason: {
    type: String,
    required: true,
    maxlength: 500
  },
  status: {
    type: String,
    required: true,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'], // Matching RequestService status casing
    default: 'Pending',
    index: true
  },
  approverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    maxlength: 500,
    default: null
  },
  attachments: [{
    filename: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  history: [{
    action: String,
    performedBy: String,
    timestamp: { type: Date, default: Date.now },
    status: String,
    reason: String
  }]
}, {
  timestamps: true,
  collection: 'leave_requests'
});

// Indexes for common queries
leaveRequestSchema.index({ userId: 1, status: 1 });
leaveRequestSchema.index({ startDate: 1, endDate: 1 });
leaveRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
