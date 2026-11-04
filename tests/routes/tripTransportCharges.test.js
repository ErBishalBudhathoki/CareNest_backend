/**
 * Multi-participant activity transport charges (Milestone 3.2).
 *
 * HTTP contract for `POST /api/trips/:tripId/transport-charges` and a
 * persistence unit test proving createTrip carries propertyId/clientIds
 * onto the Trip document.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: jest.fn().mockRejectedValue(new Error('not a firebase token')),
  }),
}));
const TEST_JWT_SECRET = 'trip-transport-charges-test-secret';
jest.mock('../../services/jwtKeyRotationService', () => ({
  getValidKeys: jest
    .fn()
    .mockResolvedValue([{ keyId: 'test-key', secret: 'trip-transport-charges-test-secret' }]),
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

const mockCreateActivityTransportCharges = jest.fn();
jest.mock('../../services/providerTravelService', () => ({
  createActivityTransportCharges: (...args) => mockCreateActivityTransportCharges(...args),
}));

const mockTripCreate = jest.fn();
jest.mock('../../models/Trip', () => ({
  create: (...args) => mockTripCreate(...args),
}));
jest.mock('../../models/Organization', () => ({
  findById: jest.fn().mockResolvedValue(null),
}));

const app = require('../../app');

const ORG_ID = '507f1f77bcf86cd799439012';
const TRIP_ID = '507f1f77bcf86cd7994390dd';

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

let server;
let baseUrl;

describe('POST /api/trips/:tripId/transport-charges', () => {
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

  const send = () =>
    withToken(
      request(baseUrl).post(`/api/trips/${TRIP_ID}/transport-charges`),
      adminToken()
    );

  test('creates transport charges via the travel service', async () => {
    const charges = [
      { clientId: 'c1', km: 15, share: 0.5, supportItemNumber: '01_799_0107_1_1' },
      { clientId: 'c2', km: 15, share: 0.5, supportItemNumber: '01_799_0107_1_1' },
    ];
    mockCreateActivityTransportCharges.mockResolvedValue(charges);

    const res = await send().send({ date: '2026-11-03' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe('TRANSPORT_CHARGES_CREATED');
    expect(res.body.data.charges).toEqual(charges);
    expect(mockCreateActivityTransportCharges).toHaveBeenCalledWith(
      ORG_ID,
      { tripId: TRIP_ID, date: '2026-11-03' },
      '507f1f77bcf86cd7994390cc'
    );
  });

  test('maps a missing trip (service 404) onto HTTP 404', async () => {
    const err = new Error('Trip not found.');
    err.statusCode = 404;
    err.code = 'TRIP_NOT_FOUND';
    mockCreateActivityTransportCharges.mockRejectedValue(err);

    const res = await send().send({});

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('TRIP_NOT_FOUND');
  });

  test('maps a missing participant list (service 400) onto HTTP 400', async () => {
    const err = new Error('At least one participant must be specified for activity transport.');
    err.statusCode = 400;
    mockCreateActivityTransportCharges.mockRejectedValue(err);

    const res = await send().send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects a non-mongo tripId with 400 VALIDATION_ERROR', async () => {
    const res = await withToken(
      request(baseUrl).post('/api/trips/not-an-id/transport-charges'),
      adminToken()
    ).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockCreateActivityTransportCharges).not.toHaveBeenCalled();
  });

  test('rejects clientIds that are not an array with 400', async () => {
    const res = await send().send({ clientIds: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockCreateActivityTransportCharges).not.toHaveBeenCalled();
  });

  test('rejects non-mongo ids in clientIds with 400', async () => {
    const res = await send().send({ clientIds: ['not-an-id'] });

    expect(res.status).toBe(400);
    expect(mockCreateActivityTransportCharges).not.toHaveBeenCalled();
  });

  test('rejects anonymous access with 401', async () => {
    const res = await request(baseUrl).post(`/api/trips/${TRIP_ID}/transport-charges`).send({});
    expect(res.status).toBe(401);
    expect(mockCreateActivityTransportCharges).not.toHaveBeenCalled();
  });
});

describe('TripService.createTrip persists SIL transport fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('stores propertyId and clientIds on the Trip document', async () => {
    mockTripCreate.mockImplementation(async (doc) => ({
      ...doc,
      _id: { toString: () => TRIP_ID },
      toObject: () => doc,
    }));
    const TripService = require('../../services/tripService');

    await TripService.createTrip({
      organizationId: ORG_ID,
      userId: '507f1f77bcf86cd7994390cc',
      date: '2026-11-03',
      startLocation: 'House A',
      endLocation: 'Day program',
      distance: 30,
      tripType: 'WITH_CLIENT',
      clientId: '507f1f77bcf86cd7994390bb',
      propertyId: '507f1f77bcf86cd7994390ee',
      clientIds: ['507f1f77bcf86cd7994390bb', '507f1f77bcf86cd7994390ff'],
    });

    expect(mockTripCreate).toHaveBeenCalledTimes(1);
    const doc = mockTripCreate.mock.calls[0][0];
    expect(doc.propertyId).toBe('507f1f77bcf86cd7994390ee');
    expect(doc.clientIds).toEqual([
      '507f1f77bcf86cd7994390bb',
      '507f1f77bcf86cd7994390ff',
    ]);
  });

  test('defaults clientIds to [] and propertyId to null when omitted', async () => {
    mockTripCreate.mockImplementation(async (doc) => ({
      ...doc,
      _id: { toString: () => TRIP_ID },
      toObject: () => doc,
    }));
    const TripService = require('../../services/tripService');

    await TripService.createTrip({
      organizationId: ORG_ID,
      userId: '507f1f77bcf86cd7994390cc',
      date: '2026-11-03',
      startLocation: 'Depot',
      endLocation: 'House A',
      distance: 12,
      tripType: 'BETWEEN_CLIENTS',
    });

    const doc = mockTripCreate.mock.calls[0][0];
    expect(doc.propertyId).toBeNull();
    expect(doc.clientIds).toEqual([]);
  });
});
