const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  tradingName: String,
  organizationName: String,  // Alias for 'name'
  code: { type: String, required: true, trim: true, uppercase: true },
  organizationCode: String,  // Alias for 'code'
  abn: String,
  logoUrl: String,
  ownerEmail: { type: String, required: true, lowercase: true, trim: true },
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
  integrations: {
    xero: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      // Custom OAuth credentials (optional, overrides global .env credentials)
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    myob: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    quickbooks: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    googleCalendar: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    outlookCalendar: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    appleCalendar: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    slack: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    teams: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    discord: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    stripe: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    paypal: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    square: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    salesforce: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    hubspot: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    zapier: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    },
    webhooks: {
      isConnected: { type: Boolean, default: false },
      apiKey: String,
      accessToken: String,
      refreshToken: String,
      connectedAt: Date,
      disconnectedAt: Date,
      lastSync: Date,
      metadata: mongoose.Schema.Types.Mixed,
      customClientId: String,
      customClientSecret: String,
      useCustomCredentials: { type: Boolean, default: false },
    }
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
    reminderDay: { type: Number, default: 0 },
    reminderHour: { type: Number, default: 18 },
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
  stripeAccountId: { type: String },
  subscription: {
    plan: { type: String, enum: ['basic', 'professional', 'enterprise'], default: 'basic' },
    maxUsers: { type: Number, default: 10 },
    maxSharedEmployees: { type: Number, default: 5 },
    features: [String]
  }
}, {
  timestamps: true,
  collection: 'organizations',
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      
      if (ret.createdAt) ret.createdAt = ret.createdAt.toISOString();
      if (ret.updatedAt) ret.updatedAt = ret.updatedAt.toISOString();
      if (ret.parentOrganizationId) ret.parentOrganizationId = ret.parentOrganizationId.toString();
      
      return ret;
    }
  }
});

// Indexes
organizationSchema.index({ code: 1 }, { unique: true });
organizationSchema.index({ ownerEmail: 1 });

module.exports = mongoose.model('Organization', organizationSchema);
