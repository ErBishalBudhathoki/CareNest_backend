const mongoose = require('mongoose');

const integrationLogSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  integrationType: {
    type: String,
    required: true,
    enum: [
      'xero', 'myob', 'quickbooks',
      'googleCalendar', 'outlookCalendar', 'appleCalendar',
      'slack', 'teams', 'discord',
      'stripe', 'paypal', 'square',
      'salesforce', 'hubspot',
      'zapier', 'webhooks'
    ],
    index: true,
  },
  action: {
    type: String,
    required: true,
    enum: ['connect', 'disconnect', 'sync', 'oauth_connect', 'test', 'webhook'],
  },
  status: {
    type: String,
    required: true,
    enum: ['success', 'failed', 'pending'],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  error: {
    type: String,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index for efficient queries
integrationLogSchema.index({ organizationId: 1, integrationType: 1, timestamp: -1 });

// TTL index to automatically delete old logs after 90 days
integrationLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

const IntegrationLog = mongoose.model('IntegrationLog', integrationLogSchema);

module.exports = IntegrationLog;
