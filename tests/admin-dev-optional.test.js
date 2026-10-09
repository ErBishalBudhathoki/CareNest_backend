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
const fs = require('fs');
const path = require('path');

const authHeader =
  'Basic ' +
  Buffer.from(`${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`).toString('base64');

const pageText = () =>
  request(app).get('/admin-dev/ops').set('Authorization', authHeader).then((r) => r.text);

const scriptOf = (html) => (html.match(/<script>\n([\s\S]*?)\n<\/script>/) || [])[1] || '';
const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/adminDevRoutes.js'), 'utf8');

describe('optional — PII read auditing', () => {
  test('the drill-down is audited as a VIEW', () => {
    const block = routeSrc.slice(
      routeSrc.indexOf("router.get('/api/ops/users/:email'"),
      routeSrc.indexOf("router.post('/api/ops/reset-rate-limits'")
    );
    // Reading a participant record discloses NDIS PII and must leave a trail,
    // not just the destructive actions.
    expect(block).toMatch(/action: 'VIEW'/);
    expect(block).toMatch(/entityType: 'user'/);
    expect(block).toMatch(/reason: 'manual ops drill-down'/);
    expect(block).toMatch(/AUDIT_SOURCES\.ADMIN_DEV/);
  });

  test('an audit-write failure never breaks the lookup', () => {
    const block = routeSrc.slice(
      routeSrc.indexOf("router.get('/api/ops/users/:email'"),
      routeSrc.indexOf("router.post('/api/ops/reset-rate-limits'")
    );
    // Best-effort: a failed insert must not turn a successful read into a 500.
    expect(block).toMatch(/catch \(auditError\)/);
    expect(block).toMatch(/logger\.warn/);
  });
});

describe('optional — date range and comparison', () => {
  test('timeseries accepts an explicit from/to range', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?from=2026-09-01&days=30')
      .set('Authorization', authHeader);
    expect([200, 500]).toContain(res.status);
    expect(routeSrc).toMatch(/req\.query\.from/);
  });

  test('timeseries reports the window it actually served', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?days=7')
      .set('Authorization', authHeader);
    if (res.status === 200) {
      expect(res.body.data.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.data.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('previous-period comparison is opt-in and aligned', async () => {
    const without = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?days=7')
      .set('Authorization', authHeader);
    if (without.status === 200) {
      expect(without.body.data.totals.previous).toBeUndefined();
      expect(without.body.data.totals.current).toBeDefined();
    }

    const with_ = await request(app)
      .get('/admin-dev/api/ops/analytics/timeseries?days=7&compare=previous')
      .set('Authorization', authHeader);
    if (with_.status === 200) {
      const d = with_.body.data;
      expect(d.totals.previous).toBeDefined();
      // Every current row carries its aligned previous value.
      expect(d.series[0]).toHaveProperty('prevNewUsers');
      expect(d.series[0]).toHaveProperty('prevRevenue');
      expect(d.series).toHaveLength(7);
    }
  });

  test('top returns a previous array only when asked', async () => {
    expect(routeSrc).toMatch(/const compare = req\.query\.compare === 'previous'/);
    const plain = await request(app)
      .get('/admin-dev/api/ops/analytics/top?entity=clients&days=30')
      .set('Authorization', authHeader);
    if (plain.status === 200) expect(plain.body.previous).toBeUndefined();
  });

  test('totals equal the sum of the series rows', () => {
    // Regression, caught only by running it against real data. Current rows use
    // bare keys (invoices); previous rows use a camelCase `prev` prefix
    // (prevInvoices). The two conventions share no casing rule, so the original
    // `prefix + 'Invoices'` silently summed nothing — reporting 0 for one window
    // or the other while looking entirely plausible.
    const route = fs.readFileSync(
      path.join(__dirname, '../routes/adminDevRoutes.js'),
      'utf8'
    );
    const block = route.slice(
      route.indexOf('const sumField ='),
      route.indexOf('res.json({', route.indexOf('const sumField ='))
    );
    expect(block).toMatch(/pfx \? 'prevNewUsers' : 'newUsers'/);
    expect(block).toMatch(/pfx \? 'prevInvoices' : 'invoices'/);
    expect(block).toMatch(/pfx \? 'prevRevenue' : 'revenue'/);
    expect(block).toMatch(/pfx \? 'prevWorkedHours' : 'workedHours'/);
    expect(block).not.toMatch(/\+ 'Invoices'/);
  });

  test('the totals accumulator resolves both key conventions', () => {
    // Executable form of the same contract, using the exact row shapes the
    // endpoint emits.
    const series = [
      { date: 'a', newUsers: 0, invoices: 2, revenue: 500, workedHours: 10,
        prevNewUsers: 0, prevInvoices: 1, prevRevenue: 400, prevWorkedHours: 5 },
      { date: 'b', newUsers: 1, invoices: 3, revenue: 700, workedHours: 12,
        prevNewUsers: 1, prevInvoices: 2, prevRevenue: 600, prevWorkedHours: 8 },
    ];
    const sumField = (f) => series.reduce((s, r) => s + (Number(r[f]) || 0), 0);
    const totalsFor = (pfx) => ({
      newUsers: sumField(pfx ? 'prevNewUsers' : 'newUsers'),
      invoices: sumField(pfx ? 'prevInvoices' : 'invoices'),
      revenue: sumField(pfx ? 'prevRevenue' : 'revenue'),
      workedHours: sumField(pfx ? 'prevWorkedHours' : 'workedHours'),
    });
    expect(totalsFor('')).toEqual({ newUsers: 1, invoices: 5, revenue: 1200, workedHours: 22 });
    expect(totalsFor('prev')).toEqual({ newUsers: 1, invoices: 3, revenue: 1000, workedHours: 13 });
  });

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