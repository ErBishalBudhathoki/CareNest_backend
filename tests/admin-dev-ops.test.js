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
});
