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
// and the Cloud Run shared-client wrapper expose scan()/scanStream, not keys().
async function listRlimitKeys() {
  const keys = [];
  let cursor = '0';
  do {
    const result = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 200);
    cursor = Array.isArray(result) ? String(result[0]) : '0';
    const batch = Array.isArray(result) ? result[1] : [];
    if (Array.isArray(batch)) keys.push(...batch);
  } while (cursor !== '0');
  return keys;
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
const redis = require('../config/redis');
const TemporalManager = require('../core/TemporalManager');
const { createAuditLog, AUDIT_SOURCES } = require('../services/auditService');
const { convertUsersToCSV } = require('../services/csvExport');
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
    const keys = await listRlimitKeys();
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 500) {
      await redis.del(...keys.slice(i, i + 500));
      deleted += Math.min(500, keys.length - i);
    }
    await createAuditLog({ action: 'UPDATE', entityType: 'organization', entityId: 'global', userEmail: req.devUser || 'admin-dev', organizationId: 'global', newValues: { rateLimitKeysCleared: deleted }, reason: 'manual ops reset', source: AUDIT_SOURCES.ADMIN_DEV });
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
    const keys = await listRlimitKeys();
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
    const [lb, nh] = await Promise.all([
      LeaveBalance.deleteMany({ userId: { $in: userIds } }),
      NotificationHistory.deleteMany({ userId: { $in: userIds } }),
    ]);

    await createAuditLog({ action: 'DELETE', entityType: 'organization', entityId: orgId, userEmail: req.devUser || 'admin-dev', organizationId: orgId, oldValues: { leaveBalancesDeleted: lb.deletedCount, notificationsDeleted: nh.deletedCount }, reason: 'manual ops reset', source: AUDIT_SOURCES.ADMIN_DEV });
    res.json({ success: true, leaveBalancesDeleted: lb.deletedCount, notificationsDeleted: nh.deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Platform-wide stats for the developer dashboard
router.get('/api/ops/platform-stats', devAuth, async (req, res) => {
  try {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, activeUsers, newUsers30d,
      totalOrgs,
      totalInvoices, invoices30d,
      totalClients, appointments30d,
      workedTimeAgg, pendingLeave,
      orgsWithSettings,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ lastLoginAt: { $gte: since30d } }),
      User.countDocuments({ createdAt: { $gte: since30d } }),
      Organization.countDocuments({}),
      Invoice.countDocuments({}),
      Invoice.countDocuments({ createdAt: { $gte: since30d } }),
      Client.countDocuments({}),
      Appointment.countDocuments({ createdAt: { $gte: since30d } }),
      WorkedTime.aggregate([{ $group: { _id: null, hours: { $sum: '$totalHours' } } }]),
      LeaveRequest.countDocuments({ status: 'Pending' }),
      Organization.countDocuments({ 'settings.aiInvoiceGeneration': { $exists: true } }),
    ]);

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, activeLast30d: activeUsers, newLast30d: newUsers30d },
        organizations: { total: totalOrgs, withAISettings: orgsWithSettings },
        invoices: { total: totalInvoices, last30d: invoices30d },
        clients: { total: totalClients },
        appointments: { last30d: appointments30d },
        workedHoursTotal: workedTimeAgg[0]?.hours || 0,
        leaveRequestsPending: pendingLeave,
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

    const [newUsers, activeUsers, invoices, revenue, appointments, workedHours] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: { lastLoginAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$lastLoginAt' } }, count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, total: { $sum: '$financialSummary.totalAmount' } } },
      ]),
      Appointment.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dayFmt, date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      WorkedTime.aggregate([
        { $match: { workDate: { $gte: since } } },
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
        revenue: revenueM[key] || 0,
        appointments: appointmentsM[key] || 0,
        workedHours: workedHoursM[key] || 0,
      });
    }
    res.json({ success: true, data: { days, series } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/ops/analytics/breakdown', devAuth, async (req, res) => {
  try {
    const entity = String(req.query.entity || 'invoiceStatus');
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * DAY_MS);
    let rows = [];
    if (entity === 'invoiceStatus') {
      rows = await Invoice.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$workflow.status', count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
        { $sort: { count: -1 } },
      ]);
    } else if (entity === 'paymentStatus') {
      rows = await Invoice.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$payment.status', count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
        { $sort: { count: -1 } },
      ]);
    } else if (entity === 'userRole') {
      rows = await User.aggregate([
        { $group: { _id: { $ifNull: ['$role', { $arrayElemAt: ['$roles', 0] }] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    } else {
      return res.status(400).json({ success: false, message: 'entity must be invoiceStatus|paymentStatus|userRole' });
    }
    res.json({ success: true, data: rows.map((r) => ({ label: r._id || 'unknown', count: r.count, total: r.total || 0 })) });
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
    let rows = [];
    if (entity === 'clients') {
      rows = await Invoice.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$clientEmail', count: { $sum: 1 }, total: { $sum: '$financialSummary.totalAmount' } } },
        { $sort: { total: -1 } },
        { $limit: limit },
      ]);
      return res.json({ success: true, data: rows.map((r) => ({ label: r._id, count: r.count, total: r.total || 0 })) });
    }
    if (entity === 'users') {
      rows = await WorkedTime.aggregate([
        { $match: { workDate: { $gte: since } } },
        { $group: { _id: '$userEmail', count: { $sum: 1 }, hours: { $sum: '$totalHours' } } },
        { $sort: { hours: -1 } },
        { $limit: limit },
      ]);
      return res.json({ success: true, data: rows.map((r) => ({ label: r._id, count: r.count, total: r.hours || 0 })) });
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
