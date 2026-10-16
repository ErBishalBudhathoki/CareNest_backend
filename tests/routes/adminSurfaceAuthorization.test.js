/**
 * Admin-surface authorization tests.
 *
 * SIL management (`/api/sil/*`), NDIS claiming (`/api/ndis-claims/*`) and the
 * note-template manager (`/api/notes/templates`) are reached from the Admin
 * dashboard only. Those screens live behind navigation, which is not a security
 * boundary: a support worker's token could still call the API directly. These
 * tests pin the server-side role check so the boundary cannot silently regress
 * back to UI-only.
 *
 * Reads of note templates are deliberately open to every member of the
 * organisation (the note composer picks a template), so the write routes are
 * the ones that must reject a non-admin token.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Pin the two token-verification inputs so authentication is deterministic:
// Firebase ID-token verification must always miss (these are custom JWTs) and
// the key-rotation keystore must be empty, which routes verification through
// JWT_SECRET exactly as it does in production when no rotated keys exist.
jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: jest.fn().mockRejectedValue(new Error('not a firebase token')),
  }),
}));
const TEST_JWT_SECRET = 'admin-surface-authorization-test-secret';
jest.mock('../../services/jwtKeyRotationService', () => ({
  getValidKeys: jest
    .fn()
    .mockResolvedValue([{ keyId: 'test-key', secret: 'admin-surface-authorization-test-secret' }]),
}));

// Redis/BullMQ are not available in unit tests; the app imports them at module
// load through the queue modules.
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), on: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  })),
}));

jest.mock('../../config/redis', () => ({
  call: jest.fn(),
  on: jest.fn(),
  status: 'ready',
  quit: jest.fn(),
  disconnect: jest.fn(),
  duplicate: jest.fn().mockReturnThis(),
  subscribe: jest.fn(),
  publish: jest.fn(),
}));

// The in-memory anti-bruteforce IP block would otherwise accumulate failed
// attempts from the anonymous/unauthenticated cases below and start returning
// 429 for later requests in the same file.
jest.mock('../../utils/securityMonitor', () => ({
  securityMonitor: {
    recordAuthFailure: jest.fn(),
    recordAuthSuccess: jest.fn(),
    logSecurityEvent: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
  },
}));

// Membership lookup used by organizationContext / rbac middleware. Returns an
// active employee membership so req.user stays JWT-derived.
jest.mock('../../models/UserOrganization', () => {
  function buildQuery(value) {
    return {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(value),
      then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
      catch: (fn) => Promise.resolve(value).catch(fn),
    };
  }
  return {
    findOne: jest.fn(() =>
      buildQuery({ _id: 'uo-1', role: 'employee', permissions: [], isActive: true })
    ),
    find: jest.fn(() => buildQuery([])),
    db: { readyState: 1 },
  };
});

const app = require('../../app');

const ORG_ID = '507f1f77bcf86cd799439012';

function makeToken({ email, roles }) {
  return jwt.sign(
    {
      userId: '507f1f77bcf86cd799439011',
      email,
      roles,
      organizationId: ORG_ID,
    },
    process.env.JWT_SECRET,
    { issuer: 'invoice-app', audience: 'invoice-app-users', expiresIn: '1h' }
  );
}

const employeeToken = () =>
  makeToken({ email: 'employee@example.com', roles: ['employee'] });
const adminToken = () => makeToken({ email: 'admin@example.com', roles: ['admin'] });

const withToken = (req, token) =>
  req.set('Authorization', `Bearer ${token}`).set('x-organization-id', ORG_ID);

// Each entry is a request the admin surfaces own. `expectDenied` marks the ones
// a support-worker token must not reach.
const adminOnlyRequests = [
  ['GET', '/api/sil/properties'],
  ['POST', '/api/sil/properties'],
  ['GET', `/api/sil/properties/${ORG_ID}/vacancies`],
  ['GET', '/api/sil/occupancy'],
  ['GET', '/api/sil/ratio-rules'],
  ['GET', `/api/sil/rosters?propertyId=${ORG_ID}&weekStarting=2026-10-19`],
  ['POST', '/api/sil/rosters'],
  ['POST', `/api/sil/rosters/${ORG_ID}/publish`],
  ['GET', '/api/sil/quotes'],
  ['POST', '/api/sil/quotes'],
  ['GET', '/api/sil/rosters-of-care'],
  ['GET', '/api/ndis-claims/batches'],
  ['POST', '/api/ndis-claims/generate'],
  ['GET', `/api/ndis-claims/batches/${ORG_ID}`],
  ['POST', `/api/ndis-claims/batches/${ORG_ID}/results/import`],
  ['POST', '/api/notes/templates'],
  ['PUT', `/api/notes/templates/${ORG_ID}`],
  ['DELETE', `/api/notes/templates/${ORG_ID}`],
];

// Supertest's `request(app)` spins up and tears down an ephemeral listener per
// call. With ~40 calls in this file that occasionally reuses a port still in
// TIME_WAIT and fails with "socket hang up"/a header-less request. One listener
// for the whole file keeps the assertions testing middleware, not TCP.
let server;
let baseUrl;

const send = (method, path, token) => {
  const req = request(baseUrl)[method.toLowerCase()](path);
  return withToken(req, token);
};

describe('admin-surface API authorization', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll((done) => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    process.env.JWT_SECRET = originalSecret;
    server.close(done);
  });

  test('rejects anonymous access with 401', async () => {
    const res = await request(baseUrl).get('/api/sil/properties');
    expect(res.status).toBe(401);
  });

  describe.each(adminOnlyRequests)('%s %s', (method, path) => {
    test('employee token is denied with 403 INSUFFICIENT_PERMISSIONS', async () => {
      const res = await send(method, path, employeeToken());
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('admin token is not denied by the role gate', async () => {
      const res = await send(method, path, adminToken());
      expect(res.status).not.toBe(403);
      expect(res.body?.code).not.toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  test('employee token can still read note templates (note composer)', async () => {
    const res = await send('GET', '/api/notes/templates', employeeToken());
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe('INSUFFICIENT_PERMISSIONS');
  });

  test('employee token cannot list SIL data through an aliased path', async () => {
    // Guards against the role check being attached per-route and missed on a
    // later addition: every method on the router subtree must be covered.
    const res = await send('GET', '/api/sil/rosters-of-care', employeeToken());
    expect(res.status).toBe(403);
  });
});
