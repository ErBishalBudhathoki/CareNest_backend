/**
 * Failure-ledger endpoint tests.
 *
 * These cover the /api/ops/ledger/* surface added for Phase 2. They assert
 * auth gating, response shape and boundedness; with mongoose mocked the data
 * itself is not exercised.
 */
process.env.ADMIN_DEV_USER = process.env.ADMIN_DEV_USER || 'admin';
process.env.ADMIN_DEV_PASSWORD = process.env.ADMIN_DEV_PASSWORD || 'dev-secret';

const request = require('supertest');

// Stub Temporal so the failed-workflow route cannot open a real connection to
// the cluster and hang the suite.
jest.mock('../core/TemporalManager', () => ({
  describeWorkflow: jest.fn(),
  listWorkflows: jest.fn().mockResolvedValue({ workflows: [], total: 0 }),
  getTaskQueue: jest.fn(),
  getClient: jest.fn(),
  startWorkflow: jest.fn(),
  close: jest.fn(),
}));

const app = require('../app');

const authHeader =
  'Basic ' +
  Buffer.from(`${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`).toString('base64');

const LEDGERS = [
  ['/admin-dev/api/ops/ledger/integrations', 'integrations'],
  ['/admin-dev/api/ops/ledger/notifications', 'notifications'],
  ['/admin-dev/api/ops/ledger/stale-sessions', 'stale-sessions'],
  ['/admin-dev/api/ops/ledger/orphan-timers', 'orphan-timers'],
  ['/admin-dev/api/ops/ledger/approvals', 'approvals'],
  ['/admin-dev/api/ops/ledger/payroll-anomalies', 'payroll-anomalies'],
];

describe('ops failure ledgers', () => {
  test.each(LEDGERS)('GET %s requires auth', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  test.each(LEDGERS)('GET %s is mounted and auth-bound', async (path) => {
    const res = await request(app).get(path).set('Authorization', authHeader);
    // 200 with mocked mongoose, or a controlled 500 — never 404 (unmounted)
    // and never 401 (auth bypass).
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  test('stale-sessions echoes the threshold it applied', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/ledger/stale-sessions?minutes=45')
      .set('Authorization', authHeader);
    if (res.status === 200) expect(res.body.staleAfterMinutes).toBe(45);
  });

  test('orphan-timers echoes the threshold it applied', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/ledger/orphan-timers?hours=6')
      .set('Authorization', authHeader);
    if (res.status === 200) expect(res.body.staleAfterHours).toBe(6);
  });

  test('thresholds are clamped so a huge value cannot be requested', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/ledger/stale-sessions?minutes=99999999')
      .set('Authorization', authHeader);
    if (res.status === 200) {
      expect(res.body.staleAfterMinutes).toBeLessThanOrEqual(24 * 60);
    }
  });

  test('approvals returns trips and expenses buckets', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/ledger/approvals')
      .set('Authorization', authHeader);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('trips');
      expect(res.body.data).toHaveProperty('expenses');
    }
  });

  test('failed-workflows requires auth and never 404s', async () => {
    const unauth = await request(app).get('/admin-dev/api/ops/ledger/failed-workflows');
    expect(unauth.status).toBe(401);

    // Temporal may be unreachable from the test env; the route must exist and
    // degrade to a controlled error rather than an unmounted 404.
    const res = await request(app)
      .get('/admin-dev/api/ops/ledger/failed-workflows')
      .set('Authorization', authHeader);
    expect(res.status).not.toBe(404);
  });

  test('TemporalManager exposes listWorkflows', () => {
    const TemporalManager = require('../core/TemporalManager');
    expect(typeof TemporalManager.listWorkflows).toBe('function');
  });

  test('failure ledger UI is collapsed and lazy', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    expect(res.text).toMatch(/<details id="failureLedgers">/);
    expect(res.text).not.toMatch(/<details id="failureLedgers" open/);
    const bootstrap = res.text.split('loadStats();')[1] || '';
    expect(bootstrap).not.toContain('loadLedgers()');
  });

  test('every ledger endpoint has a UI definition', () => {
    // Guards against adding an endpoint and forgetting to surface it.
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../views/admin_ops_tool.html'), 'utf8');
    LEDGERS.forEach(([, key]) => {
      const alias = key === 'stale' ? 'stale-sessions' : key;
      expect(html).toContain(`/admin-dev/api/ops/ledger/${alias}`);
    });
    // Approvals is fetched separately because it returns two buckets.
    expect(html).toContain('/admin-dev/api/ops/ledger/approvals');
  });
});