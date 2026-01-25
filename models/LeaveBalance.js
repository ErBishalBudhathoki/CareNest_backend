const mongoose = require('mongoose');

const leaveBalanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userEmail: { // Storing email for easier lookup as per existing patterns
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  leaveType: {
    type: String,
    required: true,
    enum: ['annual', 'sick', 'personal', 'longService'],
    index: true
  },
  currentBalance: {
    type: Number,
    required: true,
    default: 0,
    min: -40 // Allow some negative balance as per many AU policies, or set to 0
  },
  accruedHours: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  usedHours: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  lastAccrualDate: {
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'leave_balances'
});

// Compound index for efficient queries
leaveBalanceSchema.index({ userId: 1, leaveType: 1 }, { unique: true });
leaveBalanceSchema.index({ userEmail: 1, leaveType: 1 }, { unique: true });

module.exports = mongoose.model('LeaveBalance', leaveBalanceSchema);
