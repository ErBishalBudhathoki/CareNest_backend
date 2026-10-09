const express = require('express');
const router = express.Router();
const path = require('path');
const Organization = require('../models/Organization');

// Simple basic auth middleware for the dev tool.
//
// Comparisons use crypto.timingSafeEqual so a wrong password cannot be
// narrowed down a character at a time by timing the response.
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const devAuth = (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, userPass] = Buffer.from(b64auth, 'base64').toString().split(':');

  const adminUser = process.env.ADMIN_DEV_USER || 'admin';
  const adminSecret = process.env.ADMIN_DEV_PASSWORD;

  // adminSecret must be truthy — that check is what stops the default
  // account from authenticating when no secret is configured at all.
  if (
    adminSecret &&
    login &&
    userPass &&
    safeEqual(login, adminUser) &&
    safeEqual(userPass, adminSecret)
  ) {
    req.devUser = login;
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="401"');
  // Deliberately generic: naming the controlling env var hands an
  // unauthenticated prober the exact knob to look for.
  res.status(401).send('Authentication required.');
};

// Stateless CSRF token derived from the admin password. Basic-auth browsers
// send credentials automatically, so mutating routes must also carry a
// same-origin-injected token that a cross-site form cannot guess.
function adminDevCsrfToken() {
  const secret = process.env.ADMIN_DEV_PASSWORD || '';
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('admin-dev-csrf-v1').digest('hex');
}

function requireCsrf(req, res, next) {
  const expected = adminDevCsrfToken();
  // Header only. Accepting it in the body let it ride along in
  // urlencoded/form posts, where it ends up in access logs.
  const token = req.get('x-admin-dev-csrf');
  if (!expected || !safeEqual(token || '', expected)) {
    return res.status(403).json({ success: false, message: 'Invalid or missing CSRF token' });
  }
  return next();
}

// Inject the CSRF token into a served HTML page (placeholder marker).
function serveHtmlWithCsrf(file, req, res) {
  const html = fs.readFileSync(file, 'utf8');
  res.type('html').send(html.replace(/__ADMIN_DEV_CSRF__/g, adminDevCsrfToken()));
}

// Iterate Valkey keys without the blocking KEYS command. DisabledRedisClient
// and the Cloud Run shared-client wrapper expose scan/scanStream, not keys().
//
// Bounded on both axes. An earlier version looped until the cursor returned to
// '0' and accumulated every match into an array, so on a shared instance with
// a large rate-limit keyspace this walked the whole keyspace on every console
// page load and grew memory with it. Now it stops at a key ceiling, and reports
// whether it hit that ceiling so the UI can say the count is a floor.
const RL_SCAN_MAX_KEYS = 5000;
const RL_SCAN_MAX_ROUNDS = 50;
// The destructive reset gets a far higher ceiling than the read-only display,
// but still a ceiling — and reports when it hits one.
const RL_RESET_MAX_KEYS = 200000;
const RL_RESET_MAX_ROUNDS = 2000;

async function listRlimitKeys({ maxKeys = RL_SCAN_MAX_KEYS, maxRounds = RL_SCAN_MAX_ROUNDS } = {}) {
  const keys = [];
  let cursor = '0';
  let rounds = 0;
  let truncated = false;

  do {
    const result = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 200);
    cursor = Array.isArray(result) ? String(result[0]) : '0';
    const batch = Array.isArray(result) ? result[1] : [];

    if (Array.isArray(batch)) {
      for (const key of batch) {
        if (keys.length >= maxKeys) {
          truncated = true;
          break;
        }
        keys.push(key);
      }
    }

    rounds += 1;
    if (truncated || rounds >= maxRounds) {
      // Stop early if we hit either ceiling; cursor !== '0' means more remain.
      truncated = truncated || cursor !== '0';
      break;
    }
  } while (cursor !== '0');

  return { keys, truncated, scanned: rounds };
}

// Serve the Admin Dev Tool HTML page
router.get('/', devAuth, (req, res) => {
  serveHtmlWithCsrf(path.join(__dirname, '../views/admin_dev_tool.html'), req, res);
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
router.post('/api/organizations/:id/ai-settings', devAuth, requireCsrf, async (req, res) => {
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
router.post('/api/organizations/global-ai-settings', devAuth, requireCsrf, async (req, res) => {
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
const { Invoice } = require('../models/Invoice');
const WorkedTime = require('../models/WorkedTime');
const Appointment = require('../models/ClientAssignment');
const Client = require('../models/Client');
const LeaveRequest = require('../models/LeaveRequest');
const IntegrationLog = require('../models/IntegrationLog');
const NotificationHistoryModel = require('../models/NotificationHistory');
const RealtimeTrackingSession = require('../models/RealtimeTrackingSession');
const ActiveTimer = require('../models/ActiveTimer');
const Trip = require('../models/Trip');
const Expense = require('../models/Expense');
const PayrollRecord = require('../models/PayrollRecord');
const redis = require('../config/redis');
const TemporalManager = require('../core/TemporalManager');
const { createAuditLog, AUDIT_SOURCES } = require('../services/auditService');
const { convertUsersToCSV } = require('../services/csvExport');
const { getSystemHealthSnapshot } = require('../middleware/systemHealth');
const { getErrorMetrics } = require('../middleware/errorTracking');
const requestTiming = require('../utils/requestTiming');
const { apiUsageMonitor } = require('../utils/apiUsageMonitor');
const crypto = require('crypto');
const fs = require('fs');

// Serve the Ops Console page
router.get('/ops', devAuth, (req, res) => {
  serveHtmlWithCsrf(path.join(__dirname, '../views/admin_ops_tool.html'), req, res);
});

// Build the user list filter from request params (shared by list + export).
function buildUserFilter(query) {
  const q = (query.q || '').toString().trim();
  const filter = {};
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { email: { $regex: safe, $options: 'i' } },
      { firstName: { $regex: safe, $options: 'i' } },
      { lastName: { $regex: safe, $options: 'i' } },
    ];
  }
  if (query.orgId) filter.organizationId = String(query.orgId);
  if (query.role) filter.role = String(query.role);
  if (query.isActive === 'true') filter.isActive = true;
  else if (query.isActive === 'false') filter.isActive = false;
  if (query.isDeleted === 'true') filter.isDeleted = true;
  else filter.isDeleted = { $ne: true }; // hide soft-deleted by default
  return filter;
}


// Paginated, sortable, filtered user table
router.get('/api/ops/users', devAuth, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const sortField = ['createdAt', 'lastLoginAt', 'email', 'role'].includes(req.query.sort) ? req.query.sort : 'createdAt';
    const sortDir = req.query.order === 'asc' ? 1 : -1;

    const filter = buildUserFilter(req.query);
    const [total, rows] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('email firstName lastName role organizationId organizationCode isActive isDeleted lastLoginAt createdAt phone clientId')
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    res.json({ success: true, data: { rows, total, page, pages: Math.ceil(total / limit), limit } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export all user records (CSV/JSON). Filtered the same way as the list.
router.get('/api/ops/users/export', devAuth, async (req, res) => {
  try {
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const rows = await User.find(buildUserFilter(req.query))
      .select('email firstName lastName role organizationId organizationCode isActive isDeleted lastLoginAt createdAt phone clientId')
      .sort({ createdAt: -1 })
      .lean()
      .limit(10000);
    await createAuditLog({ action: 'EXPORT', entityType: 'user', entityId: 'bulk', userEmail: req.devUser || 'admin-dev', organizationId: 'global', newValues: { format, count: rows.length, query: req.query }, reason: 'manual ops export', source: AUDIT_SOURCES.ADMIN_DEV });
    const filename = `users_export_${new Date().toISOString().split('T')[0]}.${format}`;
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).json({ success: true, count: rows.length, data: rows });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(convertUsersToCSV(rows));
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// User lookup: profile, org memberships, devices, balance rows, audit of past actions
router.get('/api/ops/users/:email', devAuth, async (req, res) => {
  try {
    const email = String(req.params.email || '').toLowerCase();
    // `password` carries select:false so the driver already projects it out,
    // but `otp` and `refreshTokens` do not. refreshTokens holds live JWTs for
    // any user with an active session, so exclude all three explicitly rather
    // than relying on the schema default alone.
    const user = await User.findOne({ email })
      .select('-password -otp -refreshTokens')
      .lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const [memberships, fcmCount, balanceRows, recentAudits, orgCounts, invoiceAgg, recentInvoices, workedTimeAgg, leaveRequests] = await Promise.all([
      UserOrganization.find({ userId: user._id || user.id }).lean(),
      FcmToken.countDocuments({ userEmail: email }),
      LeaveBalance.find({ userEmail: email }).lean(),
      AuditLog.find({ userEmail: email }).sort({ timestamp: -1 }).limit(10).lean(),
      UserOrganization.countDocuments({ userId: user._id || user.id }),
      Invoice.aggregate([
        { $match: { clientEmail: user.email } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
      ]).catch(() => []),
      Invoice.find({ clientEmail: user.email }).sort({ createdAt: -1 }).limit(5).select('invoiceNumber workflow.status payment.status financialSummary.totalAmount createdAt').lean().catch(() => []),
      WorkedTime.aggregate([
        { $match: { userEmail: user.email } },
        { $group: { _id: null, totalHours: { $sum: '$totalHours' } } },
      ]).catch(() => []),
      LeaveRequest.find({ userEmail: email }).sort({ createdAt: -1 }).limit(5).lean().catch(() => []),
    ]);

    res.json({ success: true, data: { user, memberships, fcmTokenCount: fcmCount, leaveBalances: balanceRows, recentAudits, orgMembershipCount: orgCounts, invoices: { count: invoiceAgg[0]?.count || 0, totalValue: invoiceAgg[0]?.total || 0, recent: recentInvoices }, workedHoursTotal: workedTimeAgg[0]?.totalHours || 0, leaveRequests } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all Valkey rate-limit counters (rl:*). Body: { confirm: 'CLEAR_RL' }
router.post('/api/ops/reset-rate-limits', devAuth, requireCsrf, async (req, res) => {
  try {
    if (req.body.confirm !== 'CLEAR_RL') {
      return res.status(400).json({ success: false, message: 'Body must be { confirm: "CLEAR_RL" }' });
    }
    // Deliberately NOT capped at the display ceiling. Silently clearing only
    // the first 5k keys would leave the operator believing the instance was
    // reset when it was not. Use a high ceiling and report truncation instead.
    const { keys, truncated } = await listRlimitKeys({
      maxKeys: RL_RESET_MAX_KEYS,
      maxRounds: RL_RESET_MAX_ROUNDS,
    });
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 500) {
      await redis.del(...keys.slice(i, i + 500));
      deleted += Math.min(500, keys.length - i);
    }
    await createAuditLog({ action: 'UPDATE', entityType: 'organization', entityId: 'global', userEmail: req.devUser || 'admin-dev', organizationId: 'global', newValues: { rateLimitKeysCleared: deleted, truncated }, reason: 'manual ops reset', source: AUDIT_SOURCES.ADMIN_DEV });
    res.json({ success: true, deleted, truncated });
    return;
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leave balance integrity: users with fewer than 4 active LeaveBalance rows
router.get('/api/ops/leave-integrity', devAuth, async (req, res) => {
  try {
    // LeaveBalance has no organizationId — membership is resolved through
    // UserOrganization — so orgId would have to $lookup the membership
    // collection. Not attempted here rather than silently matching nothing;
    // an orgId is accepted and rejected explicitly.
    if (req.query.orgId) {
      return res.status(400).json({
        success: false,
        message: 'leave-integrity is platform-wide only: LeaveBalance has no organizationId to filter on',
      });
    }
    const rows = await LeaveBalance.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$userEmail', count: { $sum: 1 }, types: { $addToSet: '$leaveType' } } },
      { $match: { count: { $lt: 4 } } },
      { $sort: { count: 1 } },
      { $limit: 200 },
    ]);
    res.json({
      success: true,
      scope: 'platform',
      // Capped at 200; when more rows exist the result is a sample, not a
      // complete list, and the caller is told so.
      truncated: rows.length === 200,
      count: rows.length,
      data: rows.map((r) => ({ userEmail: r._id, balanceRows: r.count, types: r.types })),
    });
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
    const { keys, truncated, scanned } = await listRlimitKeys();
    const byPrefix = {};
    for (const k of keys) {
      const prefix = k.split(':').slice(0, 2).join(':');
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
    }
    res.json({
      success: true,
      total: keys.length,
      byPrefix,
      // When truncated, `total` is a floor, not the true key count.
      truncated,
      scannedRounds: scanned,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recent admin-dev actions from the audit trail.
//
// Match on the indexed `source` field. The previous filter keyed off the
// `reason` string, but Mongo cannot serve an anchored `^` regex from a B-tree
// index — that was a collection scan plus sort on every console page load.
// Rows written before the `source` field existed carry no source value, so a
// one-off fallback picks those up (and can be dropped once they age out).
router.get('/api/ops/audit-recent', devAuth, async (req, res) => {
  try {
    let logs = await AuditLog.find({ source: AUDIT_SOURCES.ADMIN_DEV })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    if (logs.length === 0) {
      logs = await AuditLog.find({ source: { $exists: false }, reason: /^manual ops/ })
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();
    }

    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Destructive org data reset — requires { confirm: '<orgId>' }
// Batch size for the destructive deletes. An unbounded $in of every member's
// ObjectId produces a multi-megabyte query document that can exceed the 16MB
// BSON limit on a large organisation and hard-fails.
const ORG_RESET_BATCH = 500;

router.post('/api/ops/org-reset/:orgId', devAuth, requireCsrf, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (req.body.confirm !== orgId) {
      return res.status(400).json({ success: false, message: 'Body must be { confirm: "<exact organizationId>" }' });
    }
    const org = await Organization.findById(orgId).lean();
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const memberships = await UserOrganization.find({ organizationId: orgId }).select('userId').lean();
    const userIds = memberships.map((m) => m.userId).filter(Boolean);

    let leaveBalancesDeleted = 0;
    let notificationsDeleted = 0;
    for (let i = 0; i < userIds.length; i += ORG_RESET_BATCH) {
      const batch = userIds.slice(i, i + ORG_RESET_BATCH);
      const [lb, nh] = await Promise.all([
        LeaveBalance.deleteMany({ userId: { $in: batch } }),
        NotificationHistory.deleteMany({ userId: { $in: batch } }),
      ]);
      leaveBalancesDeleted += lb.deletedCount || 0;
      notificationsDeleted += nh.deletedCount || 0;
    }

    await createAuditLog({ action: 'DELETE', entityType: 'organization', entityId: orgId, userEmail: req.devUser || 'admin-dev', organizationId: orgId, oldValues: { membersProcessed: userIds.length, leaveBalancesDeleted, notificationsDeleted }, reason: 'manual ops reset', source: AUDIT_SOURCES.ADMIN_DEV });
    res.json({ success: true, membersProcessed: userIds.length, leaveBalancesDeleted, notificationsDeleted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Platform stats for the developer dashboard.
//
// orgId is optional. Without it the figures stay platform-wide (the historical
// behaviour); with it every counter is scoped to that tenant, which is what
// makes "is org X healthy?" answerable on a multi-tenant NDIS platform.
router.get('/api/ops/platform-stats', devAuth, async (req, res) => {
  try {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orgId = req.query.orgId ? String(req.query.orgId) : null;
    const scope = orgId ? { organizationId: orgId } : {};
    const withScope = (extra) => (orgId ? { ...scope, ...extra } : extra);

    const [
      totalUsers, activeUsers, newUsers30d,
      totalOrgs,
      totalInvoices, invoices30d,
      totalClients, appointments30d,
      workedTimeAgg, pendingLeave,
      orgsWithSettings,
    ] = await Promise.all([
      User.countDocuments(withScope({})),
      User.countDocuments(withScope({ lastLoginAt: { $gte: since30d } })),
      User.countDocuments(withScope({ createdAt: { $gte: since30d } })),
      orgId ? Organization.countDocuments({ _id: orgId }) : Organization.countDocuments({}),
      Invoice.countDocuments(withScope({})),
      Invoice.countDocuments(withScope({ createdAt: { $gte: since30d } })),
      Client.countDocuments(withScope({})),
      Appointment.countDocuments(withScope({ createdAt: { $gte: since30d } })),
      // Previously an unfiltered $group over every worked-time record in the
      // platform, on every page load, with no index usable because there was no
      // filter at all. Now bounded to the same 30-day window as the other
      // counters and labelled accordingly rather than silently changing what
      // "total" means.
      WorkedTime.aggregate([
        { $match: { ...scope, workDate: { $gte: since30d } } },
        { $group: { _id: null, hours: { $sum: '$totalHours' } } },
      ]),
      LeaveRequest.countDocuments(withScope({ status: 'Pending' })),
      orgId
        ? Organization.countDocuments({ _id: orgId, 'settings.aiInvoiceGeneration': { $exists: true } })
        : Organization.countDocuments({ 'settings.aiInvoiceGeneration': { $exists: true } }),
    ]);

    res.json({
      success: true,
      data: {
        scope: orgId || 'platform',
        users: { total: totalUsers, activeLast30d: activeUsers, newLast30d: newUsers30d },
        organizations: { total: totalOrgs, withAISettings: orgsWithSettings },
        invoices: { total: totalInvoices, last30d: invoices30d },
        clients: { total: totalClients },
        appointments: { last30d: appointments30d },
        workedHoursLast30d: Math.round(workedTimeAgg[0]?.hours || 0),
        leaveRequestsPending: pendingLeave,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Failure ledgers.
//
// Each of these reads data the application already persists but that nothing
// surfaced anywhere. Together they are the closest thing the platform has to
// "something broke and nobody noticed": integration failures, push-delivery
// failures, workers that vanished mid-shift, timers that never stopped,
// workflows that failed, approvals waiting on a human, and SCHADS anomalies.
// Every endpoint is bounded and optional-org scoped.
// ---------------------------------------------------------------------------
const clampLimit = (value, dflt, max) => Math.max(1, Math.min(Number(value) || dflt, max));
// Scope helper: only apply the org filter when a valid id was supplied, so the
// platform-wide default keeps working.
const orgFilter = (query) => (query.orgId ? { organizationId: query.orgId } : {});

router.get('/api/ops/ledger/integrations', devAuth, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 100, 500);
    const rows = await IntegrationLog.find({ status: 'failed', ...orgFilter(req.query) })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/ledger/notifications', devAuth, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 100, 500);
    // NotificationHistory has no organizationId, so orgId is not applicable
    // here and is deliberately ignored rather than silently matching nothing.
    const rows = await NotificationHistoryModel.find({ status: 'failed' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/ledger/stale-sessions', devAuth, async (req, res) => {
  try {
    // A session still marked active but not updated for this long means the
    // worker's device stopped reporting without ever closing the shift.
    const minutes = clampLimit(req.query.minutes, 30, 24 * 60);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const rows = await RealtimeTrackingSession.find({ status: 'active', lastUpdate: { $lt: cutoff } })
      .sort({ lastUpdate: 1 })
      .limit(200)
      .select('appointmentId workerId status progress insideGeofence startTime lastUpdate')
      .lean();
    res.json({
      success: true,
      staleAfterMinutes: minutes,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/ledger/orphan-timers', devAuth, async (req, res) => {
  try {
    // ActiveTimer has no endTime and no status field — the model's only signal
    // for "still running" is the row existing. A timer older than the threshold
    // is therefore a timer whose worker never stopped it.
    const hours = clampLimit(req.query.hours, 12, 24 * 14);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await ActiveTimer.find({ startTime: { $lt: cutoff }, ...orgFilter(req.query) })
      .sort({ startTime: 1 })
      .limit(200)
      .lean();
    res.json({
      success: true,
      staleAfterHours: hours,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/ledger/failed-workflows', devAuth, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 25, 200);
    const result = await TemporalManager.listWorkflows({
      status: req.query.status || 'failed',
      limit,
    });
    res.json({
      success: true,
      status: String(req.query.status || 'failed').toUpperCase(),
      count: result.workflows.length,
      // True when the cluster's visibility store rejected the status filter
      // and the result was filtered client-side instead.
      degraded: result.degraded === true,
      data: result.workflows,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/ledger/approvals', devAuth, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 50, 200);
    const filter = orgFilter(req.query);
    const [trips, expenses] = await Promise.all([
      Trip.find({ adminApprovalStatus: 'PENDING', ...filter })
        .sort({ date: -1 })
        .limit(limit)
        .select('userId date status adminApprovalStatus isBillable')
        .lean(),
      Expense.find({ approvalStatus: 'pending', ...filter })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('organizationId amount description approvalStatus submittedBy createdAt')
        .lean(),
    ]);
    res.json({
      success: true,
      count: trips.length + expenses.length,
      data: { trips, expenses },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/ledger/payroll-anomalies', devAuth, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 50, 200);
    // PayrollRecord.anomalies[] is a SCHADS-compliance signal written by
    // services/anomalyService.js and previously never read by anything.
    const rows = await PayrollRecord.find({
      'anomalies.0': { $exists: true },
      ...orgFilter(req.query),
    })
      .sort({ periodStart: -1 })
      .limit(limit)
      .select('employeeId employeeName organizationId periodStart periodEnd status anomalies')
      .lean();

    const flattened = [];
    for (const record of rows) {
      for (const anomaly of record.anomalies || []) {
        flattened.push({
          employeeId: record.employeeId,
          employeeName: record.employeeName,
          organizationId: record.organizationId,
          periodStart: record.periodStart,
          periodEnd: record.periodEnd,
          payrollStatus: record.status,
          type: anomaly.type,
          description: anomaly.description,
          severity: anomaly.severity,
        });
      }
    }
    flattened.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    });

    res.json({ success: true, count: flattened.length, data: flattened.slice(0, limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Instance health.
//
// Every field here is read from process-local memory. Four of these functions
// (getSystemHealthSnapshot, getErrorMetrics, requestTiming.snapshot and the
// apiUsageMonitor readers) were already implemented and exported but had no
// callers at all, so this endpoint adds visibility without new instrumentation
// and without touching the database.
//
// The counters reset on every deploy and every Cloud Run scale-to-zero cold
// start, so the payload says so explicitly and reports `hasTraffic` so the UI
// can tell "healthy" apart from "nothing has happened yet".
// ---------------------------------------------------------------------------
const LATENCY_ROW_LIMIT = 25;

router.get('/api/ops/instance', devAuth, (req, res) => {
  try {
    const health = getSystemHealthSnapshot();
    const errors = getErrorMetrics();
    const traffic = apiUsageMonitor.getSummary();

    // requestTiming.snapshot() returns every tracked route (capped at 200 by
    // the middleware). Trim to the busiest so a long-running instance can't
    // push a huge payload into the page.
    const latency = (requestTiming.snapshot() || [])
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, LATENCY_ROW_LIMIT);

    res.json({
      success: true,
      data: {
        capturedAt: new Date().toISOString(),
        scope: 'this-instance',
        // Which build and which instance is answering. During an incident the
        // first question is usually "am I even looking at the deployed code?".
        build: {
          revision: process.env.K_REVISION || null,
          service: process.env.K_SERVICE || null,
          configuration: process.env.K_CONFIGURATION || null,
          instance: process.env.HOSTNAME || null,
          uptimeSeconds: Math.round(process.uptime()),
        },
        caveat: 'In-memory counters. Reset on deploy and on scale-to-zero cold start — not platform history.',
        hasTraffic: traffic.totalRequests > 0 || health.application.totalRequests > 0,
        health: {
          memory: health.memory,
          cpu: health.cpu,
          loadAverage: {
            '1m': health.system.loadAverage1m,
            '5m': health.system.loadAverage5m,
            '15m': health.system.loadAverage15m,
          },
          hostMemoryUsagePercent: Number(health.system.memoryUsagePercent),
          application: {
            totalRequests: health.application.totalRequests,
            totalErrors: health.application.totalErrors,
            errorRate: Number(health.application.errorRate),
            averageResponseTimeMs: health.application.averageResponseTime,
            uptimeSeconds: health.application.uptime,
          },
        },
        errors: {
          totalErrors: errors.totalErrors,
          validationErrors: errors.validationErrors,
          serverErrors: errors.serverErrors,
          clientErrors: errors.clientErrors,
          errorsByStatusCode: errors.errorsByStatusCode,
          // Object.entries().sort() yields [name, count] tuples, not objects.
          topErrorTypes: (errors.topErrorTypes || []).map(([name, count]) => ({ name, count })),
          topErrorEndpoints: (errors.topErrorEndpoints || []).map(([endpoint, count]) => ({ endpoint, count })),
        },
        traffic: {
          totalRequests: traffic.totalRequests,
          statusBuckets: traffic.statusBuckets,
          requestsLast1m: traffic.requestsLast1m,
          requestsLast5m: traffic.requestsLast5m,
          uniqueEndpoints: traffic.uniqueEndpoints,
          avgLatencyMs: traffic.avgLatencyMs,
          activeSSEClients: traffic.activeSSEClients,
          topEndpoints: traffic.topEndpoints,
        },
        latency,
        connections: apiUsageMonitor.getActiveConnections(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Analytics — time-series + distributions for the ops console charts.
// All aggregations are bounded by AGGREGATE_MAX_TIME_MS (config/mongoose.js).
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

router.get('/api/ops/analytics/timeseries', devAuth, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * DAY_MS);
    const dayFmt = '%Y-%m-%d';
    // Optional tenant scope, applied as a leading $match so the new compound
    // indexes can actually be used.
    const orgId = req.query.orgId ? String(req.query.orgId) : null;
    const scope = orgId ? { organizationId: orgId } : {};

    const [newUsers, activeUsers, invoices, revenue, appointments, workedHours] = await Promise.all([
      User.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: { ...scope, lastLoginAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$lastLoginAt' } }, count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, total: { $sum: '$financialSummary.totalAmount' } } },
      ]),
      Appointment.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      WorkedTime.aggregate([
        { $match: { ...scope, workDate: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$workDate' } }, hours: { $sum: '$totalHours' } } },
      ]),
    ]);

    const map = (arr, field) => Object.fromEntries(arr.map((d) => [d._id, d[field] || 0]));
    const newUsersM = map(newUsers, 'count');
    const activeUsersM = map(activeUsers, 'count');
    const invoicesM = map(invoices, 'count');
    const revenueM = map(revenue, 'total');
    const appointmentsM = map(appointments, 'count');
    const workedHoursM = map(workedHours, 'hours');

    const series = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * DAY_MS);
      const key = d.toISOString().split('T')[0];
      series.push({
        date: key,
        newUsers: newUsersM[key] || 0,
        activeUsers: activeUsersM[key] || 0,
        invoices: invoicesM[key] || 0,
        revenue: Math.round(revenueM[key] || 0),
        appointments: appointmentsM[key] || 0,
        workedHours: workedHoursM[key] || 0,
      });
    }
    res.json({ success: true, data: { days, scope: orgId || 'platform', series } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/analytics/breakdown', devAuth, async (req, res) => {
  try {
    const entity = String(req.query.entity || 'invoiceStatus');
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * DAY_MS);
    const orgId = req.query.orgId ? String(req.query.orgId) : null;
    const scope = orgId ? { organizationId: orgId } : {};

    let rows = [];
    let window = 'days';

    if (entity === 'invoiceStatus') {
      rows = await Invoice.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: '$workflow.status', count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
        { $sort: { count: -1 } },
      ]);
    } else if (entity === 'paymentStatus') {
      rows = await Invoice.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: '$payment.status', count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
        { $sort: { count: -1 } },
      ]);
    } else if (entity === 'userRole') {
      // Role distribution is a snapshot of who exists, not a time series — the
      // previous version computed `since` and then ignored it, so the Days
      // control silently did nothing here. Filtering by the window would make
      // this chart empty whenever no one had signed up recently, which is worse
      // than useless. Scope by tenant and say explicitly that it is all-time.
      window = 'all-time';
      rows = await User.aggregate([
        { $match: { ...scope } },
        { $group: { _id: { $ifNull: ['$role', { $arrayElemAt: ['$roles', 0] }] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    } else {
      return res.status(400).json({ success: false, message: 'entity must be invoiceStatus|paymentStatus|userRole' });
    }

    const data = rows.map((r) => ({ label: r._id || 'unknown', count: r.count, total: r.total || 0 }));
    res.json({
      success: true,
      scope: orgId || 'platform',
      window: window === 'all-time' ? 'all-time' : `${days}d`,
      count: data.length,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/analytics/top', devAuth, async (req, res) => {
  try {
    const entity = String(req.query.entity || 'clients');
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * DAY_MS);
    const orgId = req.query.orgId ? String(req.query.orgId) : null;
    const scope = orgId ? { organizationId: orgId } : {};

    let rows = [];
    if (entity === 'clients') {
      rows = await Invoice.aggregate([
        { $match: { ...scope, createdAt: { $gte: since } } },
        { $group: { _id: '$clientEmail', count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
        { $sort: { total: -1 } },
        { $limit: limit },
      ]);
      return res.json({ success: true, scope: orgId || 'platform', window: `${days}d`, count: rows.length, data: rows.map((r) => ({ label: r._id, count: r.count, total: r.total || 0 })) });
    }
    if (entity === 'users') {
      rows = await WorkedTime.aggregate([
        { $match: { ...scope, workDate: { $gte: since } } },
        { $group: { _id: '$userEmail', count: { $sum: 1 }, hours: { $sum: '$totalHours' } } },
        { $sort: { hours: -1 } },
        { $limit: limit },
      ]);
      return res.json({ success: true, scope: orgId || 'platform', window: `${days}d`, count: rows.length, data: rows.map((r) => ({ label: r._id, count: r.count, total: r.hours || 0 })) });
    }
    return res.status(400).json({ success: false, message: 'entity must be clients|users' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve the vendored Chart.js bundle only to authenticated admin users.
router.get('/static/chart.umd.js', devAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/vendor/chart.umd.js'));
});

module.exports = router;
