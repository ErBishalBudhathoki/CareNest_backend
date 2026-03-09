const mongoose = require('mongoose');

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      unique: true,
    },
    userEmail: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    categoryEnabled: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    categoryChannels: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    quietHours: {
      enabled: {
        type: Boolean,
        default: true,
      },
      startTime: {
        type: String,
        default: '22:00',
      },
      endTime: {
        type: String,
        default: '08:00',
      },
      daysOfWeek: {
        type: [Number],
        default: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    smartTimingEnabled: {
      type: Boolean,
      default: true,
    },
    geofenceEnabled: {
      type: Boolean,
      default: true,
    },
    geofenceRadiusKm: {
      type: Number,
      default: 5.0,
      min: 0.1,
      max: 20.0,
    },
    soundEnabled: {
      type: Boolean,
      default: true,
    },
    vibrationEnabled: {
      type: Boolean,
      default: true,
    },
    badgeEnabled: {
      type: Boolean,
      default: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'notification_preferences',
  }
);

module.exports = mongoose.model(
  'NotificationPreference',
  notificationPreferenceSchema
);
