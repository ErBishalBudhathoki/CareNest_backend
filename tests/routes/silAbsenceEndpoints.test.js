/**
 * Absence endpoints (Milestone 2.1) — happy paths and validation mapping.
 *
 * The service layer itself is unit-tested in tests/sil/silAbsenceBilling.test.js;
 * this suite pins the HTTP contract: routes are mounted, admin-only, validated,
 * and delegate to silOccupancyService with the authenticated organisation and
 * actor, mapping service statusCodes onto HTTP responses.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: jest.fn().mockRejectedValue(new Error('not a firebase token')),
  }),
}));
const TEST_JWT_SECRET = 'sil-absence-endpoints-test-secret';
jest.mock('../../services/jwtKeyRotationService', () => ({
  getValidKeys: jest
    .fn()
    .mockResolvedValue([{ keyId: 'test-key', secret: 'sil-absence-endpoints-test-secret' }]),
}));

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

jest.mock('../../utils/securityMonitor', () => ({
  securityMonitor: {
    recordAuthFailure: jest.fn(),
    recordAuthSuccess: jest.fn(),
    logSecurityEvent: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
  },
}));

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

// Absent the organisation is out of scope here; bypass entitlement to keep
// the test focused on the absence routes themselves.
const mockRecordAbsence = jest.fn();
const mockEndAbsence = jest.fn();
const mockListAbsences = jest.fn();
jest.mock('../../services/silOccupancyService', () => ({
  recordAbsence: (...args) => mockRecordAbsence(...args),
  endAbsence: (...args) => mockEndAbsence(...args),
  listAbsences: (...args) => mockListAbsences(...args),
}));

const app = require('../../app');

const ORG_ID = '507f1f77bcf86cd799439012';
const OCCUPANCY_ID = '507f1f77bcf86cd799439011';
const ABSENCE_ID = '507f1f77bcf86cd7994390aa';
const CLIENT_ID = '507f1f77bcf86cd7994390bb';

function makeToken({ email, roles }) {
  return jwt.sign(
    {
      userId: '507f1f77bcf86cd7994390cc',
      email,
      roles,
      organizationId: ORG_ID,
    },
    process.env.JWT_SECRET,
    { issuer: 'invoice-app', audience: 'invoice-app-users', expiresIn: '1h' }
  );
}

const adminToken = () =>
  makeToken({ email: 'admin@example.com', roles: ['admin'] });

const withToken = (req, token) =>
  req.set('Authorization', `Bearer ${token}`).set('x-organization-id', ORG_ID);

const adminReq = (method, path) => withToken(request(baseUrl)[method.toLowerCase()](path), adminToken());

let server;
let baseUrl;

describe('SIL absence endpoints', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records an absence and defaults to hospital', async () => {
    const created = { _id: ABSENCE_ID, maxClaimableDays: 28, reason: 'hospital' };
    mockRecordAbsence.mockResolvedValue(created);
    const res = await adminReq('POST', `/api/sil/occupancy/${OCCUPANCY_ID}/absences`).send({
      startDate: '2026-10-01',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(created);
    expect(mockRecordAbsence).toHaveBeenCalledTimes(1);
    expect(mockRecordAbsence).toHaveBeenCalledWith(
      ORG_ID,
      OCCUPANCY_ID,
      { startDate: '2026-10-01' },
      'admin@example.com'
    );
  });

  test('rejects a missing startDate with 400 VALIDATION_ERROR', async () => {
    const res = await adminReq('POST', `/api/sil/occupancy/${OCCUPANCY_ID}/absences`).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockRecordAbsence).not.toHaveBeenCalled();
  });

  test('rejects an unknown absence reason with 400', async () => {
    const res = await adminReq('POST', `/api/sil/occupancy/${OCCUPANCY_ID}/absences`).send({
      startDate: '2026-10-01',
      reason: 'nap',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockRecordAbsence).not.toHaveBeenCalled();
  });

  test('maps a missing occupancy (service 404) onto HTTP 404', async () => {
    const err = new Error('Occupancy not found.');
    err.statusCode = 404;
    mockRecordAbsence.mockRejectedValue(err);
    const res = await adminReq('POST', `/api/sil/occupancy/${OCCUPANCY_ID}/absences`).send({
      startDate: '2026-10-01',
    });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('ends an absence', async () => {
    const ended = { _id: ABSENCE_ID, endDate: '2026-10-15' };
    mockEndAbsence.mockResolvedValue(ended);
    const res = await adminReq('PUT', `/api/sil/occupancy/${OCCUPANCY_ID}/absences/${ABSENCE_ID}`).send({
      endDate: '2026-10-15',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(ended);
    expect(mockEndAbsence).toHaveBeenCalledWith(
      ORG_ID,
      OCCUPANCY_ID,
      ABSENCE_ID,
      { endDate: '2026-10-15' },
      'admin@example.com'
    );
  });

  test('rejects a non-mongo absenceId with 400', async () => {
    const res = await adminReq('PUT', `/api/sil/occupancy/${OCCUPANCY_ID}/absences/not-an-id`).send({
      endDate: '2026-10-15',
    });
    expect(res.status).toBe(400);
    expect(mockEndAbsence).not.toHaveBeenCalled();
  });

  test('lists absences filtered by clientId', async () => {
    const rows = [{ _id: ABSENCE_ID, clientId: CLIENT_ID, reason: 'hospital' }];
    mockListAbsences.mockResolvedValue(rows);
    const res = await adminReq('GET', `/api/sil/absences?clientId=${CLIENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.absences).toEqual(rows);
    expect(mockListAbsences).toHaveBeenCalledWith(ORG_ID, {
      occupancyId: undefined,
      clientId: CLIENT_ID,
      propertyId: undefined,
    });
  });

  test('rejects an invalid clientId query with 400', async () => {
    const res = await adminReq('GET', '/api/sil/absences?clientId=not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockListAbsences).not.toHaveBeenCalled();
  });

  test('passes no filters when none are provided', async () => {
    mockListAbsences.mockResolvedValue([]);
    const res = await adminReq('GET', '/api/sil/absences');
    expect(res.status).toBe(200);
    expect(mockListAbsences).toHaveBeenCalledWith(ORG_ID, {
      occupancyId: undefined,
      clientId: undefined,
      propertyId: undefined,
    });
  });

  test('rejects anonymous access with 401', async () => {
    const res = await request(baseUrl).get('/api/sil/absences');
    expect(res.status).toBe(401);
    expect(mockListAbsences).not.toHaveBeenCalled();
  });
});
