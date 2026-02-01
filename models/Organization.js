const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  tradingName: String,
  organizationName: String,  // Alias for 'name' used by some endpoints
  code: { type: String, required: true },
  organizationCode: String,  // Alias for 'code' used by some endpoints
  abn: String,
  logoUrl: String,
  ownerEmail: String,
  ownerFirstName: String,
  ownerLastName: String,
  address: {
    street: String,
    city: String,
    state: String,
    postcode: String,
    country: String
  },
  contactDetails: {
    phone: String,
    email: String,
    website: String
  },
  bankDetails: {
    bankName: String,
    accountName: String,
    bsb: String,
    accountNumber: String,
    isVerified: { type: Boolean, default: false }
  },
  ndisRegistration: {
    isRegistered: Boolean,
    registrationNumber: String,
    renewalDate: String,
    expiryDate: String
  },
  businessName: String,
  settings: {
    mileage: {
      defaultBillingRate: {
        type: Number,
        default: 0
      }
    }
  },
  timesheetReminders: {
    enabled: { type: Boolean, default: true },
    reminderDay: { type: Number, default: 0 }, // 0 = Sunday
    reminderHour: { type: Number, default: 18 }, // 6 PM
    reminderMinute: { type: Number, default: 0 },
    timezone: { type: String, default: 'Australia/Sydney' },
    updatedAt: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  parentOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  isMultiOrgEnabled: { type: Boolean, default: false },
  allowedDomains: [String],
  stripeAccountId: { type: String }, // For Stripe Connect
  subscription: {
    plan: { type: String, enum: ['basic', 'professional', 'enterprise'], default: 'basic' },
    maxUsers: { type: Number, default: 10 },
    maxSharedEmployees: { type: Number, default: 5 },
    features: [String]
  }
}, {
  timestamps: true,
  collection: 'organizations'
});

module.exports = mongoose.model('Organization', organizationSchema);
