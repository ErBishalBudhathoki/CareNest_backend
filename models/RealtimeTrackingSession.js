const mongoose = require('mongoose');

const trackingLocationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
      default: 10,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },
    progress: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      default: '',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const realtimeTrackingSessionSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      required: true,
      index: true,
      unique: true,
      trim: true,
    },
    workerId: {
      type: String,
      required: true,
      trim: true,
    },
    clientLocation: {
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
    },
    startTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    endTime: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      default: 'active',
      index: true,
    },
    progress: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      default: '',
    },
    locations: {
      type: [trackingLocationSchema],
      default: [],
    },
    geofenceRadius: {
      type: Number,
      default: 100,
    },
    insideGeofence: {
      type: Boolean,
      default: false,
    },
    arrivalTime: {
      type: Date,
      default: null,
    },
    departureTime: {
      type: Date,
      default: null,
    },
    lastUpdate: {
      type: Date,
      default: null,
      index: true,
    },
    lastStatusUpdate: {
      type: Date,
      default: null,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'realtimeTrackingSessions',
  }
);

module.exports = mongoose.model(
  'RealtimeTrackingSession',
  realtimeTrackingSessionSchema
);
