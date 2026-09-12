const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock Redis/BullMQ
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    on: jest.fn()
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn()
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn()
  }))
}));

// Mock Redis/Rate Limit
jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  })),
}));

jest.mock('../config/redis', () => ({
  call: jest.fn(),
  on: jest.fn(),
  status: 'ready',
  quit: jest.fn(),
  disconnect: jest.fn(),
  duplicate: jest.fn().mockReturnThis(),
  subscribe: jest.fn(), // Added subscribe
  publish: jest.fn()    // Added publish
}));

jest.mock('../services/earningsService', () => ({
  getEarningsSummary: jest.fn(async () => ({
    totalHours: 1,
    totalEarnings: 10,
    payRate: 10,
    payType: 'Hourly',
    history: [],
  })),
  getProjectedEarnings: jest.fn(async () => ({
    projectedHours: 1,
    projectedEarnings: 10,
    breakdown: [],
  })),
  getEarningsHistory: jest.fn(async () => ({
    bucket: 'month',
    payRate: 10,
    items: [],
  })),
  setPayRate: jest.fn(async () => true),
}));

jest.mock('../services/invoiceManagementService', () => {
  const getBusinessStatistics = jest.fn(async () => ({
    success: true,
    data: {
      activeBusinesses: 1,
      totalClients: 2,
      totalInvoices: 3,
      totalRevenue: '$4.00',
    },
  }));

  return {
    InvoiceManagementService: {
      getBusinessStatistics,
    },
  };
});

// Mock UserOrganization
// IMPORTANT: jest.mock() factories are hoisted before variable declarations, so
// all constants must be inlined as literals inside the factory.
jest.mock('../models/UserOrganization', () => {
  const ADMIN_ORG = '507f1f77bcf86cd799439012';

  // Returns a thenable query chain compatible with both:
  //   await UserOrganization.findOne(q)           (organizationContext.js)
  //   await UserOrganization.findOne(q).select().lean()  (rbac.js)
  function buildQuery(value) {
    return {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(value),
      then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
      catch: (fn) => Promise.resolve(value).catch(fn),
    };
  }

  const findOneMock = jest.fn();
  findOneMock.mockImplementation(function (query) {
    if (!query) return buildQuery(null);

    // organizationContext.js does a plain membership lookup (no $or).
    // Return a basic active-member record for ADMIN_ORG so the middleware
    // can set req.organizationContext. Role is irrelevant for this check.
    const orgMatchesAdmin =
      query.organizationId === ADMIN_ORG ||
      (query.organizationId && query.organizationId.$in && query.organizationId.$in.includes(ADMIN_ORG));

    if (!query.$or && orgMatchesAdmin) {
      return buildQuery({ _id: 'uo-1', role: 'employee', permissions: [], isActive: true });
    }

    // rbac.js _hasOrganizationAdminRole queries with $or role conditions.
    // We intentionally return null here so the DB-based admin check is skipped
    // and only the JWT role claim (_hasAdminRole) decides access — which is the
    // correct behavior for unit tests that don't have a real DB.
    return buildQuery(null);
  });

  return {
    findOne: findOneMock,
    // readyState=1 so organizationContextMiddleware proceeds to call findOne.
    // rbac._hasOrganizationAdminRole also sees readyState=1 but gets null back
    // from findOne, so it returns false — falling back to JWT role check only.
    db: { readyState: 1 },
  };
});

// Import app.js to avoid server startup during tests
const app = require('../app');

function makeToken({ email, roles, organizationId }) {
  const secret = process.env.JWT_SECRET;
  return jwt.sign(
    {
      userId: '507f1f77bcf86cd799439011',
      email,
      roles,
      organizationId,
    },
    secret,
    { issuer: 'invoice-app', audience: 'invoice-app-users', expiresIn: '1h' }
  );
}

describe('RBAC', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  test('employee cannot access invoice stats', async () => {
    const token = makeToken({
      email: 'employee@example.com',
      roles: ['employee'],
      organizationId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .get('/api/invoices/stats/507f1f77bcf86cd799439012')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', '507f1f77bcf86cd799439012');

    expect(res.status).toBe(403);
  });

  test('admin org mismatch denied for invoice stats', async () => {
    const token = makeToken({
      email: 'admin@example.com',
      roles: ['admin'],
      organizationId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .get('/api/invoices/stats/507f1f77bcf86cd799439013') // Different valid ID
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', '507f1f77bcf86cd799439013');

    expect(res.status).toBe(403);
  });

  test('admin can access invoice stats for their org', async () => {
    const token = makeToken({
      email: 'admin@example.com',
      roles: ['admin'],
      organizationId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .get('/api/invoices/stats/507f1f77bcf86cd799439012')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', '507f1f77bcf86cd799439012');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  test('employee cannot request another user earnings summary', async () => {
    const token = makeToken({
      email: 'employee@example.com',
      roles: ['employee'],
      organizationId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .get('/api/earnings/summary/other@example.com?startDate=2026-01-01&endDate=2026-01-07')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('employee can request their own earnings summary', async () => {
    const token = makeToken({
      email: 'employee@example.com',
      roles: ['employee'],
      organizationId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .get('/api/earnings/summary/employee@example.com?startDate=2026-01-01&endDate=2026-01-07')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('employee cannot set pay rate', async () => {
    const token = makeToken({
      email: 'employee@example.com',
      roles: ['employee'],
      organizationId: '507f1f77bcf86cd799439012',
    });

    const res = await request(app)
      .post('/api/earnings/rate/employee@example.com')
      .send({ rate: 25, type: 'Hourly' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
