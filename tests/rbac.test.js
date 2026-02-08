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

const app = require('../server');

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
      .set('Authorization', `Bearer ${token}`);

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
      .set('Authorization', `Bearer ${token}`);

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
      .set('Authorization', `Bearer ${token}`);

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
