/**
 * Auth brute-force IP blocks: inspection, self-unblock, and the security
 * dashboard unblock path.
 *
 * `authenticateUser` blocks an IP for an hour after 5 failed auth attempts in
 * 15 minutes, and the block lives in an in-memory map in the running process.
 * The `/api/security/dashboard/unblock-ip` route sits behind that same
 * middleware, so a blocked machine could never clear its own block. The
 * `/admin-dev` ops endpoints exist to close that hole.
 */
const crypto = require('crypto');

process.env.ADMIN_DEV_USER = process.env.ADMIN_DEV_USER || 'admin';
process.env.ADMIN_DEV_PASSWORD =
  process.env.ADMIN_DEV_PASSWORD || 'dev-secret';

const express = require('express');
const request = require('supertest');
const {
  AuthMiddleware,
  authenticateUser,
} = require('../middleware/auth');
const securityDashboardController = require('../controllers/securityDashboardController');

const authHeader =
  'Basic ' +
  Buffer.from(
    `${process.env.ADMIN_DEV_USER}:${process.env.ADMIN_DEV_PASSWORD}`
  ).toString('base64');

const csrfToken = () =>
  crypto
    .createHmac('sha256', process.env.ADMIN_DEV_PASSWORD)
    .update('admin-dev-csrf-v1')
    .digest('hex');

// The ops endpoints are mounted on a minimal app rather than the full
// application: the auth layer under test lives inside the router (basic auth +
// CSRF), and booting `app.js` in a unit test pulls in every service and
// scheduler for no extra coverage.
const app = express();
app.use(express.json());
app.use('/admin-dev', require('../routes/adminDevRoutes'));

const TEST_IP = '198.51.100.42';

/** Let a catchAsync-wrapped handler finish before asserting on its res. */
const settleHandler = () => new Promise((resolve) => setImmediate(resolve));

/** Express-like req/res pair for calling a middleware directly. */
function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

const blockedReq = (ip) => ({
  ip,
  originalUrl: '/api/notes/templates',
  path: '/api/notes/templates',
  headers: {},
  get: () => undefined,
});

const blockIp = () => {
  for (let i = 0; i < 5; i += 1) AuthMiddleware.recordFailedAttempt(TEST_IP);
};

afterEach(() => {
  AuthMiddleware.resetFailedAttempts(TEST_IP);
  AuthMiddleware.cleanup();
});

describe('auth IP block ops surface', () => {
  test('GET /admin-dev/api/ops/auth-blocks requires basic auth', async () => {
    const res = await request(app).get('/admin-dev/api/ops/auth-blocks');
    expect(res.status).toBe(401);
  });

  test('lists a blocked IP with its failed-attempt count', async () => {
    blockIp();

    const res = await request(app)
      .get('/admin-dev/api/ops/auth-blocks')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.blockedIPs.map((entry) => entry.ip)).toContain(TEST_IP);
    const attemptEntry = res.body.data.failedAttempts.find(
      (entry) => entry.ip === TEST_IP
    );
    expect(attemptEntry.attempts).toBe(5);
  });

  test('a blocked IP is refused by authenticateUser with 429 IP_BLOCKED', async () => {
    blockIp();

    const res = mockRes();
    await authenticateUser(blockedReq(TEST_IP), res, () => {});

    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('IP_BLOCKED');
  });

  test('POST unblock is rejected without the CSRF token', async () => {
    blockIp();

    const res = await request(app)
      .post('/admin-dev/api/ops/auth-blocks/unblock')
      .set('Authorization', authHeader)
      .send({ ip: TEST_IP });

    expect(res.status).toBe(403);
    expect(AuthMiddleware.isIPBlocked(TEST_IP)).toBe(true);
  });

  test('unblock clears the block so the IP can reach normal auth again', async () => {
    blockIp();
    expect(AuthMiddleware.isIPBlocked(TEST_IP)).toBe(true);

    const res = await request(app)
      .post('/admin-dev/api/ops/auth-blocks/unblock')
      .set('Authorization', authHeader)
      .set('x-admin-dev-csrf', csrfToken())
      .send({ ip: TEST_IP });

    expect(res.status).toBe(200);
    expect(res.body.unblocked).toBe(true);
    expect(AuthMiddleware.isIPBlocked(TEST_IP)).toBe(false);

    // The middleware no longer refuses the request for being blocked; it now
    // fails on the missing token, which is the expected unblocked behaviour.
    const probe = mockRes();
    await authenticateUser(blockedReq(TEST_IP), probe, () => {});
    expect(probe.statusCode).toBe(401);
    expect(probe.body.code).toBe('MISSING_TOKEN');
  });

  test('omitting the ip clears every block', async () => {
    blockIp();
    AuthMiddleware.recordFailedAttempt('203.0.113.9');
    AuthMiddleware.recordFailedAttempt('203.0.113.9');
    AuthMiddleware.recordFailedAttempt('203.0.113.9');
    AuthMiddleware.recordFailedAttempt('203.0.113.9');
    AuthMiddleware.recordFailedAttempt('203.0.113.9');

    const res = await request(app)
      .post('/admin-dev/api/ops/auth-blocks/unblock')
      .set('Authorization', authHeader)
      .set('x-admin-dev-csrf', csrfToken())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
    expect(AuthMiddleware.getBlockedIPsAdmin()).toHaveLength(0);

    AuthMiddleware.resetFailedAttempts('203.0.113.9');
  });
});

describe('security dashboard unblock clears the auth block too', () => {
  test('clears the AuthMiddleware block, not just the security monitor', async () => {
    blockIp();
    expect(AuthMiddleware.isIPBlocked(TEST_IP)).toBe(true);

    const req = {
      body: { ip: TEST_IP },
      ip: '10.0.0.1',
      user: { id: 'u1', email: 'admin@org.com' },
    };
    const res = mockRes();

    securityDashboardController.unblockIp(req, res);
    await settleHandler();

    expect(res.body.code).toBe('IP_UNBLOCKED');
    expect(AuthMiddleware.isIPBlocked(TEST_IP)).toBe(false);
  });

  test('still 404s when the IP was never blocked', async () => {
    const req = {
      body: { ip: '192.0.2.77' },
      ip: '10.0.0.1',
      user: { id: 'u1', email: 'admin@org.com' },
    };
    const res = mockRes();

    securityDashboardController.unblockIp(req, res);
    await settleHandler();

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('IP_NOT_BLOCKED');
  });
});
