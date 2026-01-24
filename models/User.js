
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  organizationId: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  password: {
    type: String,
    required: true
  },
  salt: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  organizationCode: {
    type: String
  },
  role: {
    type: String,
    default: 'user',
    enum: ['user', 'admin', 'superadmin'] 
  },
  roles: {
    type: [String],
    default: []
  },
  jobRole: {
    type: String
  },
  phone: String,
  profilePic: String,
  payRate: { type: Number, default: 0 },
  rates: {
    baseRate: Number,
    saturdayRate: Number,
    sundayRate: Number,
    publicHolidayRate: Number,
    overtimeRate: Number,
    overtimeRate2: Number,
    nightShiftRate: Number,
    eveningShiftRate: Number
  },
  activeAllowances: [String],
  payType: String,
  stream: String,
  classificationLevel: String,
  payPoint: String,
  employmentType: String,
  dob: Date,
  fcmToken: {
    type: String
  },
  lastLogin: {
    type: Date
  },
  photo: {
    data: Buffer,
    contentType: String,
    uploadedAt: Date
  },
  otp: {
    type: String
  },
  otpExpiry: {
    type: Date
  },
  otpUsed: {
    type: Boolean
  },
  passwordUpdatedAt: {
    type: Date
  }
}, {
  timestamps: true,
  collection: 'users'
});

module.exports = mongoose.model('User', userSchema);
