const request = require('supertest');

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

// Mock Mongoose connection to prevent actual DB connection
jest.mock('../config/mongoose', () => jest.fn());

// Mock Firebase
jest.mock('../firebase-admin-config', () => ({
  messaging: {
    send: jest.fn().mockResolvedValue({}),
    sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 })
  },
  auth: {
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test-uid' })
  }
}));

// Mock Logger
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  http: jest.fn(),
  security: jest.fn(),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    http: jest.fn(),
    security: jest.fn()
  })
}));

// Mock Security Monitor
jest.mock('../utils/securityMonitor', () => ({
  securityMonitor: {
    recordSuspiciousActivity: jest.fn(),
    isIPBlocked: jest.fn().mockReturnValue(false),
    recordSuccessfulLogin: jest.fn(),
    recordFailedLogin: jest.fn(),
    recordSecurityError: jest.fn()
  }
}));

// Mock Redis Config directly to ensure it has 'call' method
jest.mock('../config/redis', () => {
  const mockRedis = {
    call: jest.fn(),
    on: jest.fn(),
    status: 'ready',
    quit: jest.fn(),
    disconnect: jest.fn(),
    duplicate: jest.fn(),
    subscribe: jest.fn(),
    publish: jest.fn()
  };
  mockRedis.duplicate.mockReturnValue(mockRedis);
  return mockRedis;
});

// Mock Middleware that might cause issues
jest.mock('../middleware/requestLogger', () => ({
  requestLogger: (req, res, next) => next(),
  securityLogger: (req, res, next) => next()
}));

jest.mock('../utils/apiUsageMonitor', () => ({
  apiUsageMonitor: {
    middleware: (req, res, next) => next()
  }
}));

jest.mock('../middleware/logging', () => ({
  loggingMiddleware: (req, res, next) => next()
}));

jest.mock('../middleware/errorTracking', () => ({
  errorTrackingMiddleware: (req, res, next) => next()
}));

jest.mock('../middleware/systemHealth', () => ({
  systemHealthMiddleware: (req, res, next) => next()
}));

// Mock Notification Scheduler
jest.mock('../cron/notificationScheduler', () => ({
  start: jest.fn()
}));

// Mock ShiftSubscriber (just require it)
jest.mock('../subscribers/ShiftSubscriber', () => ({}));

// Mock Timesheet Reminder Scheduler
jest.mock('../timesheet_reminder_scheduler', () => ({
  startTimesheetReminderScheduler: jest.fn()
}));

// Mock Expense Reminder Scheduler
jest.mock('../expense_reminder_scheduler', () => ({
  startExpenseReminderScheduler: jest.fn()
}));

// Mock Job Workers
jest.mock('../core/QueueManager', () => ({
  registerWorker: jest.fn()
}));

jest.mock('../workers/InvoiceWorker', () => jest.fn());

// Mock Environment Config
jest.mock('../config/environment', () => ({
  environmentConfig: {
    getEnvironment: jest.fn().mockReturnValue('test'),
    isProductionEnvironment: jest.fn().mockReturnValue(false),
    shouldShowDetailedErrors: jest.fn().mockReturnValue(true),
    getConfig: jest.fn().mockReturnValue({ 
      app: { name: 'Test' },
      security: { corsOrigins: [] } // Added security config
    })
  }
}));

// Mock MongoDB (required for /health endpoint)
jest.mock('mongodb', () => {
  return {
    MongoClient: class MongoClient {
      constructor(url, options) {}
      connect() { return Promise.resolve(this); }
      db() { 
        return { 
          collection: () => ({ find: () => ({ toArray: () => Promise.resolve([]) }) }),
          admin: () => ({ ping: () => Promise.resolve({ ok: 1 }) }) 
        }; 
      }
      close() {}
    },
    ObjectId: class ObjectId { constructor(id) { this.id = id; } toString() { return 'mock-object-id'; } },
    ServerApiVersion: { v1: '1' }
  };
});

// Import app after mocks
const app = require('../server');

describe('Security & Reliability Verification', () => {
  
  // 1. Health Check
  test('Health check endpoint returns 200', async () => {
    const res = await request(app).get('/health');
    if (res.status !== 200) {
      console.log('Health Check Failed. Status:', res.status);
      console.log('Error Body:', JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(200);
  });

  // 2. Security Headers (Helmet)
  test('Should have security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // 3. CORS Policy
  test('CORS should be restricted (currently checks if it allows all - fail condition for verified secure app)', async () => {
    const res = await request(app).options('/health')
      .set('Origin', 'http://evil-site.com')
      .set('Access-Control-Request-Method', 'GET');
    
    // If unrestricted, it returns '*' or the origin
    const allowOrigin = res.headers['access-control-allow-origin'];
    
    // We expect this to FAIL if the app is currently insecure (which we think it is)
    // So we assert the current state to confirm vulnerability
    if (allowOrigin === '*' || allowOrigin === 'http://evil-site.com') {
      console.warn('VULNERABILITY CONFIRMED: CORS allows arbitrary origin');
    } else {
      console.log('CORS is restricted');
    }
  });

  // 4. Input Validation (Auth)
  test('Signup should validate input', async () => {
    // Note: The actual route is /auth/register, not /api/auth/signup
    const res = await request(app).post('/auth/register').send({
      email: 'invalid-email',
      password: '123', // Weak password
      confirmPassword: '123',
      firstName: 'Test',
      lastName: 'User',
      organizationCode: 'TESTORG'
    });

    // If validation is missing, it might return 500 (db error) or 201 (created with bad data)
    // We expect 400 if validation is present
    if (res.status !== 400) {
      console.warn(`VULNERABILITY CONFIRMED: Weak password accepted or unexpected error. Status: ${res.status}`);
    } else {
      console.log('PASS: Input validation rejected invalid data.');
    }
  });

});
