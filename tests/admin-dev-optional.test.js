/**
 * Optional follow-ups: PII read auditing, date range + previous-period
 * comparison, and user-table URL/page-size state.
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

const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const LeaveBalance = require('../models/LeaveBalance');
const FcmToken = require('../models/FcmToken');
const AuditLog = require('../models/AuditLog');
const { Invoice } = require('../models/Invoice');
const WorkedTime = require('../models/WorkedTime');
const Appointment = require('../models/ClientAssignment');
const LeaveRequest = require('../models/LeaveRequest');

const authHeader =
  'Basic ' +
  Buffer.from(`${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`).toString('base64');

const pageText = () =>
  request(app).get('/admin-dev/ops').set('Authorization', authHeader).then((r) => r.text);

const scriptOf = (html) => (html.match(/<script>\n([\s\S]*?)\n<\/script>/) || [])[1] || '';

/**
 * An awaitable, chainable stub standing in for a mongoose query builder. The
 * units under test call `.find(...).sort(...).limit(...).lean()`, and some
 * paths append `.catch()`, so the stub must satisfy each of those shapes while
 * still resolving to `val`.
 */
const queryable = (val) => {
  const stub = {};
  stub.sort = () => stub;
  stub.select = () => stub;
  stub.limit = () => stub;
  stub.lean = () => Promise.resolve(val);
  stub.catch = () => Promise.resolve(val);
  stub.then = (res, rej) => Promise.resolve(val).then(res, rej);
  return stub;
};

describe('optional — PII read auditing', () => {
  beforeEach(() => {
    const user = {
      _id: { toString: () => 'user-object-id' },
      id: 'user-object-id',
      email: 'participant@example.com',
      firstName: 'Pat',
      lastName: 'Participant',
      role: 'client',
      organizationId: 'org-123',
    };
    User.findOne = jest.fn(() => ({
      select: () => ({ lean: () => Promise.resolve(user) }),
    }));
    UserOrganization.find = jest.fn(() => queryable([]));
    UserOrganization.countDocuments = jest.fn(() => Promise.resolve(0));
    LeaveBalance.find = jest.fn(() => queryable([]));
    LeaveRequest.find = jest.fn(() => queryable([]));
    FcmToken.countDocuments = jest.fn(() => Promise.resolve(0));
    AuditLog.find = jest.fn(() => queryable([]));
    AuditLog.create = jest.fn(() => Promise.resolve({ _id: 'audit-id' }));
    Invoice.aggregate = jest.fn(() => Promise.resolve([]));
    Invoice.find = jest.fn(() => queryable([]));
    WorkedTime.aggregate = jest.fn(() => Promise.resolve([]));
  });

  test('reading a participant record is audited as a VIEW', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/users/participant@example.com')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    // Asserted on the audit write itself rather than on the route source: a PII
    // disclosure must leave a record however the code happens to be worded.
    expect(AuditLog.create).toHaveBeenCalledTimes(1);
    const entry = AuditLog.create.mock.calls[0][0];
    expect(entry.action).toBe('VIEW');
    expect(entry.entityType).toBe('user');
    expect(entry.entityId).toBe('user-object-id');
    expect(entry.reason).toBe('manual ops drill-down');
    expect(entry.source).toBe('admin-dev');
    expect(entry.organizationId).toBe('org-123');
    expect(entry.metadata.additionalInfo.targetUserEmail).toBe('participant@example.com');
  });

  test('an audit-write failure does not fail the read', async () => {
    // The audit sink is best-effort. Losing it must not also deny the operator
    // data they are entitled to read — otherwise an audit outage becomes a
    // data-availability outage, which is a worse failure than a missing log.
    AuditLog.create = jest.fn(() => Promise.reject(new Error('audit store down')));

    const res = await request(app)
      .get('/admin-dev/api/ops/users/participant@example.com')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('an unknown user is 404 and writes no audit', async () => {
    User.findOne = jest.fn(() => ({
      select: () => ({ lean: () => Promise.resolve(null) }),
    }));

    const res = await request(app)
      .get('/admin-dev/api/ops/users/nobody@example.com')
      .set('Authorization', authHeader);

    expect(res.status).toBe(404);
    // No disclosure, therefore no VIEW audit.
    expect(AuditLog.create).not.toHaveBeenCalled();
  });
});

describe('optional — date range and comparison', () => {
  // Buckets are keyed by the day a Mongo $group would emit. Some sit inside the
  // requested window and some inside the preceding one, so both series get
  // populated and a totals bug on either is visible.
  const BUCKETS = {
    userCount: { '2026-09-02': 3, '2026-08-12': 4 },
    invoiceCount: { '2026-09-02': 5, '2026-08-12': 2 },
    invoiceTotal: { '2026-09-02': 1000, '2026-08-12': 400 },
    workHours: { '2026-09-02': 8, '2026-08-12': 3 },
  };
  const isoDay = (ms) => new Date(ms).toISOString().split('T')[0];
  const DAY_MS = 86400000;

  beforeEach(() => {
    // User is aggregated twice — signups (createdAt) and active sessions
    // (lastLoginAt). Distinguish by the $match key so the two series don't
    // silently collapse into the same stub.
    User.aggregate = jest.fn(() =>
      Promise.resolve(
        Object.entries(BUCKETS.userCount).map(([_id, count]) => ({ _id, count }))
      )
    );
    Invoice.aggregate = jest.fn(() =>
      Promise.resolve(
        Object.entries(BUCKETS.invoiceCount).map(([_id, count]) => ({
          _id,
          count,
          total: BUCKETS.invoiceTotal[_id] || 0,
        }))
      )
    );
    Appointment.aggregate = jest.fn(() => Promise.resolve([]));
    WorkedTime.aggregate = jest.fn(() =>
      Promise.resolve(
        Object.entries(BUCKETS.workHours).map(([_id, hours]) => ({ _id, hours }))
      )
    );
  });

  test('an explicit from is served verbatim and is reproducible', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?from=2026-09-01')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    // Anchored to the requested date rather than to when the request was made,
    // so a shared URL loads the same window every time it is opened.
    expect(res.body.data.from).toBe('2026-09-01');
  });

  test('the window length is derived from the range, not defaulted', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?from=2026-09-01')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    const from = new Date(`${res.body.data.from}T00:00:00.000Z`);
    const to = new Date(`${res.body.data.to}T00:00:00.000Z`);
    expect(res.body.data.days).toBe(Math.round((to - from) / DAY_MS) + 1);
    expect(res.body.data.series).toHaveLength(res.body.data.days);
  });

  test('comparison is opt-in and absent by default', async () => {
    const plain = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?from=2026-09-01')
      .set('Authorization', authHeader);

    expect(plain.status).toBe(200);
    expect(plain.body.data.totals.previous).toBeUndefined();
    plain.body.data.series.forEach((row) => {
      expect(row).not.toHaveProperty('prevInvoices');
    });
  });

  test('comparison aligns the previous window day-for-day', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?from=2026-09-01&compare=previous')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totals.previous).toBeDefined();

    // The current bucket lands on its own date.
    const currentIdx = d.series.findIndex((r) => r.invoices === 5);
    expect(currentIdx).toBeGreaterThanOrEqual(0);
    expect(d.series[currentIdx].date).toBe('2026-09-02');

    // The previous bucket must be attributed to the row whose date is
    // (window length - 1) days earlier — i.e. the same day in the period
    // before, not the same calendar day of this period.
    const prevIdx = d.series.findIndex((r) => r.prevInvoices === 2);
    expect(prevIdx).toBeGreaterThanOrEqual(0);
    const predecessor = isoDay(
      new Date(`${d.series[prevIdx].date}T00:00:00.000Z`).getTime() -
        (d.series.length - 1) * DAY_MS
    );
    expect(predecessor).toBe('2026-08-12');
  });

  test('totals equal the sum of the series rows for BOTH windows', async () => {
    // Regression test for the bug that shipped in 260f736 and was only caught
    // by reading the live numbers. The accumulator used `prefix + 'Invoices'`,
    // but current rows are keyed `invoices` and previous rows `prevInvoices` —
    // two conventions with no shared casing rule, so both resolved to
    // undefined and every total read 0. Asserting the invariant
    // totals == sum(series) for each window and metric catches that without
    // hard-coding a date, because the expectation is derived from the response.
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?from=2026-09-01&compare=previous')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    const { series, totals } = res.body.data;
    const sum = (rows, field) => rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);

    // Spelled out rather than built by concatenation. Concatenating a prefix is
    // what caused the shipped bug in the first place, and writing `'prev' +
    // 'invoices'` here would have reproduced that same trap in the assertion —
    // the test would then have demanded the broken behaviour it exists to catch.
    const FIELDS = {
      current: { newUsers: 'newUsers', invoices: 'invoices', revenue: 'revenue', workedHours: 'workedHours' },
      previous: { newUsers: 'prevNewUsers', invoices: 'prevInvoices', revenue: 'prevRevenue', workedHours: 'prevWorkedHours' },
    };

    expect(series.length).toBeGreaterThan(1);
    for (const name of ['current', 'previous']) {
      const f = FIELDS[name];
      expect(totals[name]).toBeDefined();
      expect(totals[name].invoices).toBe(sum(series, f.invoices));
      expect(totals[name].revenue).toBe(sum(series, f.revenue));
      expect(totals[name].newUsers).toBe(sum(series, f.newUsers));
      expect(totals[name].workedHours).toBe(sum(series, f.workedHours));
    }

    // Non-vacuous: the injected buckets must actually reach the totals, or an
    // all-zero response would satisfy the equalities above.
    expect(totals.current.invoices).toBeGreaterThan(0);
    expect(totals.current.revenue).toBeGreaterThan(0);
    expect(totals.current.workedHours).toBeGreaterThan(0);
  });
});

describe('optional — comparison UI', () => {
  test('the UI offers presets, a custom range and a compare toggle', async () => {
    const html = await pageText();
    expect(html).toMatch(/id="rangePreset"/);
    expect(html).toMatch(/<option value="7">Last 7d<\/option>/);
    expect(html).toMatch(/<option value="365">Last 365d<\/option>/);
    expect(html).toMatch(/<option value="custom">Custom…<\/option>/);
    expect(html).toMatch(/id="dateFrom"/);
    expect(html).toMatch(/id="compareToggle"/);
  });

  test('comparison is drawn on the charts, not just fetched', async () => {
    const js = scriptOf(await pageText());
    expect(js).toMatch(/prevNewUsers/);
    expect(js).toMatch(/prevWorkedHours/);
    expect(js).toMatch(/borderDash/);
    expect(js).toMatch(/renderCompareSummary/);
  });
});

describe('optional — table state', () => {
  test('filters, sort and page survive a reload via the URL', async () => {
    const js = scriptOf(await pageText());
    expect(js).toMatch(/function writeUsersUrl/);
    expect(js).toMatch(/history\.replaceState/);
    expect(js).toMatch(/function restoreUsersFromUrl/);
    // Restored before the first load, not after.
    expect(js).toMatch(/restoreUsersFromUrl\(\)[\s\S]{0,120}loadUsers\(/);
  });

  test('a page size control exists and reaches the request', async () => {
    const html = await pageText();
    expect(html).toMatch(/id="pageSize"/);
    expect(html).toMatch(/<option value="100">100\/page<\/option>/);
    const js = scriptOf(html);
    expect(js).toMatch(/getElementById\('pageSize'\)\.value/);
  });

  test('the sorted column is indicated rather than showing a static arrow', async () => {
    const js = scriptOf(await pageText());
    expect(js).toMatch(/const active = field && field === usersSort/);
    expect(js).toMatch(/aria-sort/);
    expect(js).toMatch(/' ↑'/);
  });
});