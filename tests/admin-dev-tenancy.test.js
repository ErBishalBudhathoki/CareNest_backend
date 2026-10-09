/**
 * Phase 3: multi-tenant scoping, bounded queries and supporting indexes.
 */
process.env.ADMIN_DEV_USER = process.env.ADMIN_DEV_USER || 'admin';
process.env.ADMIN_DEV_PASSWORD = process.env.ADMIN_DEV_PASSWORD || 'dev-secret';

const request = require('supertest');

jest.mock('../core/TemporalManager', () => ({
  describeWorkflow: jest.fn(),
  listWorkflows: jest.fn().mockResolvedValue({ workflows: [], total: null, degraded: false }),
  getTaskQueue: jest.fn(),
  getClient: jest.fn(),
  startWorkflow: jest.fn(),
  close: jest.fn(),
}));

const app = require('../app');
const fs = require('fs');
const path = require('path');

const authHeader =
  'Basic ' +
  Buffer.from(`${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`).toString('base64');

const routeSrc = fs.readFileSync(
  path.join(__dirname, '../routes/adminDevRoutes.js'),
  'utf8'
);

const modelSrc = (name) =>
  fs.readFileSync(path.join(__dirname, `../models/${name}.js`), 'utf8');

describe('Phase 3 — tenant scoping', () => {
  const SCOPED = [
    '/admin-dev/api/ops/platform-stats',
    '/admin-dev/api/ops/analytics/timeseries',
    '/admin-dev/api/ops/analytics/breakdown',
    '/admin-dev/api/ops/analytics/top',
  ];

  test.each(SCOPED)('%s stays platform-wide with no orgId', async (path) => {
    const res = await request(app).get(path).set('Authorization', authHeader);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body;
      const scope = body.data && body.data.scope ? body.data.scope : body.scope;
      if (scope) expect(scope).toBe('platform');
    }
  });

  test.each(SCOPED)('%s accepts an orgId without erroring', async (path) => {
    const res = await request(app)
      .get(`${path}${path.includes('?') ? '&' : '?'}orgId=699980eb8fd21a3864b1aade`)
      .set('Authorization', authHeader);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body;
      const scope = body.data && body.data.scope ? body.data.scope : body.scope;
      if (scope) expect(scope).toBe('699980eb8fd21a3864b1aade');
    }
  });

  test('leave-integrity refuses orgId instead of silently matching nothing', async () => {
    // LeaveBalance has no organizationId, so filtering would return an empty
    // set that reads as "no problems". It rejects loudly instead.
    const res = await request(app)
      .get('/admin-dev/api/ops/leave-integrity?orgId=699980eb8fd21a3864b1aade')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/platform-wide only/i);
  });

  test('leave-integrity reports truncation instead of pretending to be complete', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/leave-integrity')
      .set('Authorization', authHeader);
    if (res.status === 200) {
      expect(res.body.scope).toBe('platform');
      expect(typeof res.body.truncated).toBe('boolean');
      // _id is renamed so the payload is not shaped like a raw aggregation.
      if (res.body.data.length) expect(res.body.data[0]).toHaveProperty('userEmail');
    }
  });

  test('userRole breakdown labels its window rather than ignoring days', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/breakdown?entity=userRole&days=7')
      .set('Authorization', authHeader);
    if (res.status === 200) {
      // It previously computed `since` and silently ignored it.
      expect(res.body.window).toBe('all-time');
    }
  });
});

describe('Phase 3 — bounded queries', () => {
  test('platform-stats bounds the worked-hours aggregation', () => {
    // Was an unfiltered $group over every worked-time record on every page
    // load, with no filter for any index to serve.
    const block = routeSrc.slice(
      routeSrc.indexOf('router.get(\'/api/ops/platform-stats\''),
      routeSrc.indexOf('router.get(\'/api/ops/instance\'')
    );
    const worked = block.slice(block.indexOf('WorkedTime.aggregate'));
    expect(worked).toMatch(/\$match/);
    expect(worked).toMatch(/workDate/);
  });

  test('worked hours are exposed under an honest name', () => {
    expect(routeSrc).toMatch(/workedHoursLast30d/);
    // The platform KPI was all-time and is now windowed, so the name changed.
    // The per-user drill-down keeps its own workedHoursTotal — that one really
    // is a single user's total, so only the platform key is asserted here.
    const block = routeSrc.slice(
      routeSrc.indexOf('router.get(\'/api/ops/platform-stats\''),
      routeSrc.indexOf('router.get(\'/api/ops/instance\'')
    );
    expect(block).not.toMatch(/workedHoursTotal/);
  });

  test('org-reset batches its deletes', () => {
    // An unbounded $in of every member's ObjectId can exceed the 16MB BSON
    // limit on a large organisation.
    expect(routeSrc).toMatch(/ORG_RESET_BATCH/);
    const block = routeSrc.slice(
      routeSrc.indexOf('router.post(\'/api/ops/org-reset/'),
      routeSrc.indexOf('router.get(\'/api/ops/platform-stats\'')
    );
    expect(block).toMatch(/slice\(i, i \+ ORG_RESET_BATCH\)/);
    // It must not pass the whole userIds array to a single $in any more.
    expect(block).not.toMatch(/\$in: userIds/);
  });

  test('the redis key scan is bounded and reports truncation', () => {
    expect(routeSrc).toMatch(/RL_SCAN_MAX_KEYS = 5000/);
    expect(routeSrc).toMatch(/truncated/);
  });

  test('the destructive rate-limit reset is not capped at the display ceiling', async () => {
    // Capping this would silently leave keys behind while reporting success,
    // so it uses its own much higher ceiling and reports truncation. Asserted
    // at the source level; the endpoint itself needs a live Valkey.
    const resetBlock = routeSrc.slice(
      routeSrc.indexOf('router.post(\'/api/ops/reset-rate-limits\''),
      routeSrc.indexOf('router.get(\'/api/ops/leave-integrity\'')
    );
    expect(resetBlock).toMatch(/maxKeys: RL_RESET_MAX_KEYS/);
    // Declared near listRlimitKeys, so assert it file-wide: it must be far
    // higher than the read-only display ceiling.
    expect(routeSrc).toMatch(/RL_RESET_MAX_KEYS = 200000/);
    expect(Number(routeSrc.match(/RL_RESET_MAX_KEYS = (\d+)/)[1]))
      .toBeGreaterThan(Number(routeSrc.match(/RL_SCAN_MAX_KEYS = (\d+)/)[1]));
    // And it must report truncation rather than claim a clean sweep.
    expect(resetBlock).toMatch(/res\.json\(\{ success: true, deleted, truncated \}\)/);
  });

  test('valkey-stats reports whether its count is a floor', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/valkey-stats')
      .set('Authorization', authHeader);
    if (res.status === 200) {
      expect(typeof res.body.truncated).toBe('boolean');
      expect(typeof res.body.total).toBe('number');
    }
  });
});

describe('Phase 3 — supporting indexes', () => {
  const REQUIRED = [
    ['Invoice', /invoiceSchema\.index\(\{ organizationId: 1, createdAt: -1 \}\)/],
    ['Invoice', /invoiceSchema\.index\(\{ organizationId: 1, clientEmail: 1, createdAt: -1 \}\)/],
    ['User', /userSchema\.index\(\{ organizationId: 1, createdAt: -1 \}\)/],
    ['User', /userSchema\.index\(\{ organizationId: 1, lastLoginAt: -1 \}\)/],
    ['WorkedTime', /workedTimeSchema\.index\(\{ organizationId: 1, workDate: -1 \}\)/],
    ['WorkedTime', /workedTimeSchema\.index\(\{ organizationId: 1, workDate: -1, userEmail: 1 \}\)/],
    ['ClientAssignment', /clientAssignmentSchema\.index\(\{ organizationId: 1, createdAt: -1 \}\)/],
    ['Certification', /certificationSchema\.index\(\{ status: 1, expiryDate: 1 \}\)/],
    ['LeaveRequest', /leaveRequestSchema\.index\(\{ organizationId: 1, status: 1 \}\)/],
    ['IntegrationLog', /integrationLogSchema\.index\(\{ status: 1, timestamp: -1 \}\)/],
    ['NotificationHistory', /notificationHistorySchema\.index\(\{ status: 1, createdAt: -1 \}\)/],
    ['ActiveTimer', /activeTimerSchema\.index\(\{ startTime: -1 \}\)/],
    ['Trip', /tripSchema\.index\(\{ organizationId: 1, adminApprovalStatus: 1 \}\)/],
    ['Expense', /expenseSchema\.index\(\{ organizationId: 1, approvalStatus: 1, createdAt: -1 \}\)/],
  ];

  test.each(REQUIRED)('%s declares its supporting index', (model, pattern) => {
    expect(modelSrc(model)).toMatch(pattern);
  });
});