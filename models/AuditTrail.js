const mongoose = require('mongoose');

const auditTrailSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  organizationId: String,
  action: String,
  metadata: Object,
  userAgent: String,
  ipAddress: String
}, {
  timestamps: true,
  collection: 'audit_trail'
});

module.exports = mongoose.model('AuditTrail', auditTrailSchema);
