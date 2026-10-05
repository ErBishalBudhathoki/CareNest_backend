const express = require('express');
const router = express.Router();
const path = require('path');
const Organization = require('../models/Organization');

// Simple basic auth middleware for the dev tool
const devAuth = (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, userPass] = Buffer.from(b64auth, 'base64').toString().split(':');

  const adminUser = process.env.ADMIN_DEV_USER || 'admin';
  const adminSecret = process.env.ADMIN_DEV_PASSWORD;

  if (login && userPass && login === adminUser && userPass === adminSecret && adminSecret) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Authentication required. Missing or incorrect ADMIN_DEV_PASSWORD.');
};

// Serve the Admin Dev Tool HTML page
router.get('/', devAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin_dev_tool.html'));
});

// Get all organizations and their AI settings
router.get('/api/organizations', devAuth, async (req, res) => {
  try {
    const orgs = await Organization.find({}).select('name organizationCode settings.aiInvoiceGeneration');
    res.json({ success: true, data: orgs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update AI settings for a specific organization
router.post('/api/organizations/:id/ai-settings', devAuth, async (req, res) => {
  try {
    const { frequency } = req.body;
    if (!['manual', 'weekly', 'monthly', 'off'].includes(frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency' });
    }

    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    if (!org.settings) org.settings = {};
    if (!org.settings.aiInvoiceGeneration) org.settings.aiInvoiceGeneration = {};
    
    org.settings.aiInvoiceGeneration.frequency = frequency;
    await org.save();

    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Global override for all organizations
router.post('/api/organizations/global-ai-settings', devAuth, async (req, res) => {
  try {
    const { frequency } = req.body;
    if (!['manual', 'weekly', 'monthly', 'off'].includes(frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency' });
    }

    await Organization.updateMany(
      {},
      { $set: { 'settings.aiInvoiceGeneration.frequency': frequency } }
    );

    res.json({ success: true, message: `All organizations updated to ${frequency}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Ops console — developer-only tool for inspection, resets, and reports.
// Mounted under the same basic-auth + prod-skip gate as the AI settings
// tool above (see app.js). All mutating actions audit-log via
// services/auditService.createAuditLog and require an explicit `confirm`.
// ---------------------------------------------------------------------------
const User = require('../models/User');
const LeaveBalance = require('../models/LeaveBalance');
const Certification = require('../models/Certification');
const NotificationHistory = require('../models/NotificationHistory');
const FcmToken = require('../models/FcmToken');
const AuditLog = require('../models/AuditLog');
const UserOrganization = require('../models/UserOrganization');
const redis = require('../config/redis');
const TemporalManager = require('../core/TemporalManager');
const { createAuditLog } = require('../services/auditService');

// Serve the Ops Console page
router.get('/ops', devAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin_ops_tool.html'));
});

// User lookup: profile, org memberships, devices, balance rows, audit of past actions
router.get('/api/ops/users/:email', devAuth, async (req, res) => {
  try {
    const email = String(req.params.email || '').toLowerCase();
    const user = await User.findOne({ email }).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const [memberships, fcmCount, balanceRows, recentAudits, orgCounts] = await Promise.all([
      UserOrganization.find({ userId: user._id || user.id }).lean(),
      FcmToken.countDocuments({ userEmail: email }),
      LeaveBalance.find({ userEmail: email }).lean(),
      AuditLog.find({ userEmail: email }).sort({ createdAt: -1 }).limit(10).lean(),
      UserOrganization.countDocuments({ userId: user._id || user.id }),
    ]);

    res.json({ success: true, data: { user, memberships, fcmTokenCount: fcmCount, leaveBalances: balanceRows, recentAudits, orgMembershipCount: orgCounts } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all Valkey rate-limit counters (rl:*). Body: { confirm: 'CLEAR_RL' }
router.post('/api/ops/reset-rate-limits', devAuth, async (req, res) => {
  try {
    if (req.body.confirm !== 'CLEAR_RL') {
      return res.status(400).json({ success: false, message: 'Body must be { confirm: "CLEAR_RL" }' });
    }
    const keys = await redis.keys('rl:*');
    let deleted = 0;
    if (keys && keys.length) {
      await redis.del(...keys);
      deleted = keys.length;
    }
    await createAuditLog({ action: 'UPDATE', entityType: 'Organization', entityId: 'global', userEmail: req.user?.email || 'admin-dev', organizationId: 'global', newValues: { rateLimitKeysCleared: deleted }, reason: 'manual ops reset' });
    res.json({ success: true, deleted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leave balance integrity: users with fewer than 4 active LeaveBalance rows
router.get('/api/ops/leave-integrity', devAuth, async (req, res) => {
  try {
    const rows = await LeaveBalance.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$userEmail', count: { $sum: 1 }, types: { $addToSet: '$leaveType' } } },
      { $match: { count: { $lt: 4 } } },
      { $sort: { count: 1 } },
      { $limit: 200 },
    ]);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Certifications expiring within ?days (default 30)
router.get('/api/ops/cert-expiry', devAuth, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const certs = await Certification.find({ status: 'active', expiryDate: { $lte: until } })
      .sort({ expiryDate: 1 })
      .limit(500)
      .lean();
    res.json({ success: true, count: certs.length, data: certs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Temporal workflow status lookup
router.get('/api/ops/temporal/:workflowId', devAuth, async (req, res) => {
  try {
    const info = await TemporalManager.describeWorkflow(req.params.workflowId);
    res.json({ success: true, data: info });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Valkey rate-limit key counts by prefix
router.get('/api/ops/valkey-stats', devAuth, async (req, res) => {
  try {
    const keys = await redis.keys('rl:*');
    const byPrefix = {};
    (keys || []).forEach((k) => {
      const prefix = k.split(':').slice(0, 2).join(':');
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
    });
    res.json({ success: true, total: (keys || []).length, byPrefix });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recent admin-dev actions from the audit trail
router.get('/api/ops/audit-recent', devAuth, async (req, res) => {
  try {
    const logs = await AuditLog.find({ entityId: 'global' })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Destructive org data reset — requires { confirm: '<orgId>' }
router.post('/api/ops/org-reset/:orgId', devAuth, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (req.body.confirm !== orgId) {
      return res.status(400).json({ success: false, message: 'Body must be { confirm: "<exact organizationId>" }' });
    }
    const org = await Organization.findById(orgId).lean();
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const [lb, nh] = await Promise.all([
      LeaveBalance.deleteMany({ userEmail: { $in: (await UserOrganization.find({ organizationId: orgId }).lean()).map((m) => m.userEmail) } }),
      NotificationHistory.deleteMany({ userId: { $in: (await UserOrganization.find({ organizationId: orgId }).lean()).map((m) => m.userId) } }),
    ]);

    await createAuditLog({ action: 'DELETE', entityType: 'Organization', entityId: orgId, userEmail: req.user?.email || 'admin-dev', organizationId: orgId, oldValues: { leaveBalancesDeleted: lb.deletedCount, notificationsDeleted: nh.deletedCount }, reason: 'manual ops reset' });
    res.json({ success: true, leaveBalancesDeleted: lb.deletedCount, notificationsDeleted: nh.deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
