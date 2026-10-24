/**
 * SIL cross-organisation isolation tests.
 *
 * `adminSurfaceAuthorization.test.js` pins the *role* gate: a support worker's
 * token cannot reach `/api/sil/*`. This file pins the *tenant* gate: an admin
 * who is a genuine member of organisation A cannot act on organisation B by
 * changing the `x-organization-id` header. That is the cross-tenant leak the
 * SIL tier-1 hardening set out to close, and it has to hold on every route,
 * not only the ones a test happened to pick.
 */

// Pin token verification: Firebase ID-token verification must always miss
// (these are custom JWTs) and the keystore must be empty so verification goes
// through JWT_SECRET.
jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: jest.fn().mockRejectedValue(new Error('not a firebase token')),
  }),
}));
const TEST_JWT_SECRET = 'sil-cross-org-test-secret';
jest.mock('../../services/jwtKeyRotationService', () => ({
  getValidKeys: jest
    .fn()
    .mockResolvedValue([{ keyId: 'test-key', secret: 'sil-cross-org-test-secret' }]),
}));

// Redis/BullMQ are not available in unit tests.
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), on: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
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

jest.mock('../../utils/securityMonitor', () => ({
  securityMonitor: {
    recordAuthFailure: jest.fn(),
    recordAuthSuccess: jest.fn(),
    logSecurityEvent: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
  },
}));

// The caller is an active admin of HOME_ORG *only*. Any request scoped to a
// different organisation must be refused by organizationContext.
const mockHomeOrgId = '507f1f77bcf86cd7994390aa';
const mockOtherOrgId = '507f1f77bcf86cd7994390bb';

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
    findOne: jest.fn((filter) =>
      buildQuery(
        filter && filter.organizationId === mockHomeOrgId
          ? { _id: 'uo-home', role: 'admin', permissions: [], isActive: true }
          : null
      )
    ),
    find: jest.fn(() => buildQuery([])),
    db: { readyState: 1 },
  };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');

const RESOURCE_ID = '507f1f77bcf86cd799439012';

// Every route mounted by routes/silRoutes.js. The id/lookup parameters are
// valid Mongo ids so that a failure is never a validation error masquerading
// as a tenancy failure.
const silRoutes = [
  ['GET', '/api/sil/properties'],
  ['POST', '/api/sil/properties'],
  ['GET', `/api/sil/properties/${RESOURCE_ID}/vacancies`],
  ['GET', `/api/sil/properties/${RESOURCE_ID}`],
  ['PUT', `/api/sil/properties/${RESOURCE_ID}`],
  ['DELETE', `/api/sil/properties/${RESOURCE_ID}`],

  ['GET', '/api/sil/occupancy'],
  ['POST', '/api/sil/occupancy'],
  ['PUT', `/api/sil/occupancy/${RESOURCE_ID}`],

  ['GET', '/api/sil/ratio-rules'],
  ['POST', '/api/sil/ratio-rules'],
  ['PUT', `/api/sil/ratio-rules/${RESOURCE_ID}`],
  ['DELETE', `/api/sil/ratio-rules/${RESOURCE_ID}`],

  ['GET', `/api/sil/rosters?propertyId=${RESOURCE_ID}&weekStarting=2026-10-19`],
  ['POST', '/api/sil/rosters'],
  ['PUT', `/api/sil/rosters/${RESOURCE_ID}`],
  ['POST', `/api/sil/rosters/${RESOURCE_ID}/publish`],
  ['GET', `/api/sil/rosters/${RESOURCE_ID}/compliance`],

  ['GET', '/api/sil/quotes'],
  ['POST', '/api/sil/quotes'],
  ['GET', `/api/sil/quotes/${RESOURCE_ID}`],
  ['PUT', `/api/sil/quotes/${RESOURCE_ID}`],
  ['POST', `/api/sil/quotes/${RESOURCE_ID}/send`],
  ['POST', `/api/sil/quotes/${RESOURCE_ID}/accept`],
  ['POST', `/api/sil/quotes/${RESOURCE_ID}/decline`],
  ['POST', `/api/sil/quotes/${RESOURCE_ID}/convert`],

  ['GET', '/api/sil/rosters-of-care'],
  ['GET', `/api/sil/rosters-of-care/${RESOURCE_ID}`],
  ['PUT', `/api/sil/rosters-of-care/${RESOURCE_ID}`],
  ['POST', `/api/sil/rosters-of-care/${RESOURCE_ID}/review`],
  ['POST', `/api/sil/rosters-of-care/${RESOURCE_ID}/materialize-shifts`],
  ['POST', `/api/sil/rosters-of-care/${RESOURCE_ID}/invoice`],
];

function adminToken() {
  return jwt.sign(
    {
      userId: '507f1f77bcf86cd799439011',
      email: 'admin@example.com',
      roles: ['admin'],
      organizationId: mockHomeOrgId,
    },
    process.env.JWT_SECRET,
    { issuer: 'invoice-app', audience: 'invoice-app-users', expiresIn: '1h' }
  );
}

let server;
let baseUrl;

const send = (method, path, orgId) =>
  request(baseUrl)
    [method.toLowerCase()](path)
    .set('Authorization', `Bearer ${adminToken()}`)
    .set('x-organization-id', orgId);

describe('SIL API cross-organisation isolation', () => {
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

  test('every SIL route is covered by this suite', () => {
    // Guards against a new route being added without a tenancy test.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../routes/silRoutes.js'),
      'utf8'
    );
    const mounted = source.match(/router\.(get|post|put|delete)\(/g) || [];
    expect(silRoutes).toHaveLength(mounted.length);
  });

  describe.each(silRoutes)('%s %s', (method, path) => {
    test('is refused for an organisation the caller does not belong to', async () => {
      const res = await send(method, path, mockOtherOrgId);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('ORG_ACCESS_DENIED');
    });

    test('is not refused for the caller own organisation', async () => {
      const res = await send(method, path, mockHomeOrgId);
      expect(res.status).not.toBe(403);
      expect(res.body?.code).not.toBe('ORG_ACCESS_DENIED');
    });
  });

  test('contradictory tenant hints are rejected before any query runs', async () => {
    const res = await request(baseUrl)
      .get(`/api/sil/rosters?propertyId=${RESOURCE_ID}&weekStarting=2026-10-19&organizationId=${mockHomeOrgId}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('x-organization-id', mockOtherOrgId);

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('ORG_ID_CONFLICT');
  });
});
