const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  code: { type: String, required: true },
  abn: String,
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
    accountNumber: String
  },
  ndisRegistration: {
    isRegistered: Boolean,
    registrationNumber: String
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
  }
}, {
  timestamps: true,
  collection: 'organizations'
});

module.exports = mongoose.model('Organization', organizationSchema);
