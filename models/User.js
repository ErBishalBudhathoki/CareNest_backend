const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    index: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  // Removed 'salt' field as bcrypt handles salt internally
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin', 'moderator', 'client'],
    default: 'user'
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    index: true
  },
  organizationId: {
    type: String,
    required: [true, 'Organization ID is required']
  },
  organizationCode: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  roles: {
    type: [String],
    default: []
  },
  jobRole: String,
  phone: {
    type: String,
    match: [/^\+?[1-9]\d{1,14}$/, 'Invalid phone number']
  },
  profilePic: String,

  // Payroll & Rates
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
  fcmToken: String,
  lastLogin: Date,

  // Security & OTP
  otp: String,
  otpExpiry: Date,
  otpUsed: Boolean,
  passwordUpdatedAt: Date,

  // Multi-org
  multiOrgEnabled: { type: Boolean, default: false },
  defaultOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  lastActiveOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },

  refreshTokens: [{
    token: { type: String, required: true },
    expires: { type: Date, required: true },
    created: { type: Date, default: Date.now },
    createdByIp: String,
    revoked: Date,
    revokedByIp: String,
    replacedByToken: String
  }]
}, {
  timestamps: true,
  collection: 'users',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      delete ret.otp; // Security: Don't expose OTP
      delete ret.refreshTokens; // Security: Don't expose refresh tokens
      
      // Handle legacy 'role' field (singular) → 'roles' (array)
      if (ret.role && (!ret.roles || ret.roles.length === 0)) {
        ret.roles = [ret.role];
      }
      delete ret.role; // Remove legacy field
      
      return ret;
    }
  }
});

// Pre-save hook: Hash password
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Instance method: Verify password
userSchema.methods.comparePassword = async function (candidatePassword) {
  // Ensure we have a valid bcrypt hash before comparing
  if (!this.password || !this.password.startsWith('$2')) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Static method: Safe user lookup
userSchema.statics.findByIdSafe = function (id) {
  return this.findById(id).select('-password -otp -refreshTokens');
};

module.exports = mongoose.model('User', userSchema);
