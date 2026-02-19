const mongoose = require('mongoose');

const userOrganizationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  role: { type: String, enum: ['owner', 'admin', 'employee', 'shared_employee'], required: true },
  permissions: [{
    type: String,
    enum: ['read', 'write', 'delete', 'manage_users', 'manage_billing', 'cross_org_access']
  }],
  isActive: { type: Boolean, default: true },
  joinedAt: { type: Date, default: Date.now },
  lastAccessedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'userorganizations'
});

// Compound index for efficient queries
userOrganizationSchema.index({ userId: 1, organizationId: 1 }, { unique: true });

module.exports = mongoose.model('UserOrganization', userOrganizationSchema);
