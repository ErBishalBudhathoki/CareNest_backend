const mongoose = require('mongoose');

const notificationSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  shiftReminders: {
    enabled: {
      type: Boolean,
      default: true
    },
    timings: [{
      type: Number,
      default: [24, 1, 0.5] // hours before shift
    }],
    quietHours: {
      start: {
        type: String,
        default: '22:00'
      },
      end: {
        type: String,
        default: '07:00'
      },
      timezone: {
        type: String,
        default: 'Australia/Sydney'
      }
    }
  },
  geofenceReminders: {
    enabled: {
      type: Boolean,
      default: true
    },
    radius: {
      type: Number,
      default: 100,
      min: 50,
      max: 500
    },
    bufferTime: {
      type: Number,
      default: 30,
      min: 15,
      max: 60
    }
  },
  expenseReminders: {
    enabled: {
      type: Boolean,
      default: true
    },
    deadlineHours: {
      type: Number,
      default: 48,
      min: 24,
      max: 72
    },
    escalationHours: {
      type: Number,
      default: 72,
      min: 48,
      max: 96
    }
  },
  timesheetReminders: {
    enabled: {
      type: Boolean,
      default: true
    },
    dayOfWeek: {
      type: Number,
      default: 0,
      min: 0,
      max: 6
    },
    time: {
      type: String,
      default: '18:00'
    }
  }
}, {
  timestamps: true
});

// Indexes
notificationSettingsSchema.index({ userId: 1 });

module.exports = mongoose.model('NotificationSetting', notificationSettingsSchema);
