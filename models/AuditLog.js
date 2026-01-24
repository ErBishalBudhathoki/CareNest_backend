const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'CREATE',
      'UPDATE',
      'DELETE',
      'APPROVE',
      'REJECT',
      'LOGIN',
      'LOGOUT',
      'EXPORT',
      'IMPORT',
      'VIEW'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: [
      'pricing',
      'expense',
      'invoice',
      'user',
      'organization',
      'client',
      'assignment'
    ]
  },
  entityId: {
    type: mongoose.Schema.Types.Mixed, // Can be ObjectId or String depending on the entity
    required: true
  },
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  organizationId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  oldValues: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  newValues: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  reason: {
    type: String,
    default: null
  },
  metadata: {
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    sessionId: { type: String, default: null },
    additionalInfo: { type: mongoose.Schema.Types.Mixed }
  }
}, {
  timestamps: true,
  collection: 'auditLogs'
});

// Indexes for common queries
auditLogSchema.index({ organizationId: 1, timestamp: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ userEmail: 1 });
auditLogSchema.index({ action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
