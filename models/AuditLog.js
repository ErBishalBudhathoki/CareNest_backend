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
      'VIEW',
      'USER_CREATED',
      'USER_LOGIN',
      'PHOTO_UPLOADED',
      'OTP_GENERATED',
      'OTP_VERIFIED',
      'PASSWORD_UPDATED'
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
  // Which subsystem wrote the row. Lets the ops console find its own actions
  // with an indexed equality match, instead of an anchored regex on `reason`
  // (Mongo cannot serve a leading-`^` from a B-tree index, so that query was a
  // collection scan on every console page load).
  source: {
    type: String,
    enum: ['app', 'admin-dev'],
    default: 'app',
    index: true
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
auditLogSchema.index({ source: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
