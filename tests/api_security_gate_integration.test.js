const request = require('supertest');
const jwt = require('jsonwebtoken');

// Set up global mock functions before any module requires to avoid hoisting issues
global.mockVerifyIdToken = jest.fn();
global.mockVerifyAppCheckToken = jest.fn();
global.mockUserFindOne = jest.fn();

// Mock all external dependencies & infrastructure to isolate the security gate
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), on: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({ on: jest.fn() }))
}));

jest.mock('../config/mongoose', () => jest.fn());

// Create mocks for Firebase Admin auth & appCheck
jest.mock('../firebase-admin-config', () => ({
  admin: {
    auth: () => ({
      verifyIdToken: (...args) => global.mockVerifyIdToken(...args)
    }),
    appCheck: () => ({
      verifyToken: (...args) => global.mockVerifyAppCheckToken(...args)
    })
  },
  messaging: {
    send: jest.fn().mockResolvedValue({}),
    sendEachForMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 })
  }
}));

// Mock Mongoose User model
jest.mock('../models/User', () => ({
  findOne: (...args) => global.mockUserFindOne(...args)
}));

// Mock Logger
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
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
    recordSecurityError: jest.fn(),
    recordRateLimitViolation: jest.fn(),
    blockIP: jest.fn()
  }
}));

// Mock Redis Client config
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

// Bypass telemetry & health-check middlewares
jest.mock('../middleware/requestLogger', () => ({
  requestLogger: (req, res, next) => next(),
  securityLogger: (req, res, next) => next()
}));

jest.mock('../utils/apiUsageMonitor', () => ({
  apiUsageMonitor: { middleware: (req, res, next) => next() }
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

jest.mock('../core/TemporalManager', () => ({
  startWorkflow: jest.fn().mockResolvedValue({ workflowId: 'mock-id' }),
  getClient: jest.fn().mockResolvedValue({})
}));

jest.mock('../core/QueueManager', () => ({
  registerWorker: jest.fn()
}));

jest.mock('../workers/InvoiceWorker', () => jest.fn());

// Mock Environment Config to allow testing security gates
jest.mock('../config/environment', () => ({
  environmentConfig: {
    getEnvironment: jest.fn().mockReturnValue('test'),
    isProductionEnvironment: jest.fn().mockReturnValue(false),
    shouldShowDetailedErrors: jest.fn().mockReturnValue(true),
    getConfig: jest.fn().mockReturnValue({ 
      app: { name: 'Test' },
      security: { corsOrigins: [] }
    })
  }
}));

// Mock MongoDB Drivers
jest.mock('mongodb', () => {
  return {
    MongoClient: class MongoClient {
      constructor() {}
      connect() { return Promise.resolve(this); }
      db() { 
        return { 
          collection: () => ({ find: () => ({ toArray: () => Promise.resolve([]) }) }),
          admin: () => ({ ping: () => Promise.resolve({ ok: 1 }) }) 
        }; 
      }
      close() {}
    },
    ObjectId: class ObjectId { constructor(id) { this._id = id || '507f1f77bcf86cd799439011'; } toString() { return '507f1f77bcf86cd799439011'; } },
    ServerApiVersion: { v1: '1' }
  };
});

// Now import the rest of the required modules after mocks are registered
const { AuthMiddleware } = require('../middleware/auth');
const app = require('../server');

describe('Zero-Trust Boundary Verification - apiSecurityGate', () => {
  const originalEnv = process.env.APP_CHECK_ENFORCEMENT;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    global.mockUserFindOne.mockReset();
    global.mockVerifyIdToken.mockReset();
    global.mockVerifyAppCheckToken.mockReset();

    // Prevent cross-test security rate limits / IP blocking
    AuthMiddleware.failedAttempts.clear();
    AuthMiddleware.blockedIPs.clear();
  });

  afterAll(() => {
    process.env.APP_CHECK_ENFORCEMENT = originalEnv;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Device Integrity Enforcement (Firebase AppCheck)', () => {
    test('Threat Vector 1: Missing App Check token when enforcement is active must fail closed', async () => {
      // Force App Check enforcement
      process.env.APP_CHECK_ENFORCEMENT = 'true';

      const response = await request(app)
        .get('/api/user/getUsers/')
        .set('X-Platform', 'android'); // Non-iOS platform to prevent iOS-specific bypass

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('MISSING_APP_CHECK_TOKEN');
      expect(response.body.message).toContain('Missing App Check token');
    });

    test('Threat Vector 2: Invalid/Spoofed App Check token must fail closed', async () => {
      process.env.APP_CHECK_ENFORCEMENT = 'true';
      global.mockVerifyAppCheckToken.mockRejectedValue(new Error('Invalid token signature'));

      const response = await request(app)
        .get('/api/user/getUsers/')
        .set('X-Platform', 'android')
        .set('X-Firebase-AppCheck', 'spoofed-appcheck-token-value');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.errorCode).toBe('INVALID_APP_CHECK_TOKEN');
    });

    test('Threat Vector 3: iOS bypass is supported for Apple Attest conditions', async () => {
      process.env.APP_CHECK_ENFORCEMENT = 'true';
      // Set platform to iOS to trigger the platform-specific AppCheck bypass
      const response = await request(app)
        .get('/api/user/getUsers/')
        .set('X-Platform', 'ios');

      // Should bypass AppCheck and proceed to Authentication check (missing token)
      expect(response.status).toBe(401);
      expect(response.body.errorCode).not.toBe('MISSING_APP_CHECK_TOKEN');
      expect(response.body.errorCode).not.toBe('INVALID_APP_CHECK_TOKEN');
      expect(response.body.code).toBe('MISSING_TOKEN'); // Failed on auth, meaning AppCheck bypassed successfully!
    });
  });

  describe('User Identity & Role Verification (Bearer JWT)', () => {
    beforeEach(() => {
      // Disable AppCheck to isolate JWT / Auth verification
      process.env.APP_CHECK_ENFORCEMENT = 'false';
    });

    test('Threat Vector 4: Missing Authorization header must fail closed', async () => {
      const response = await request(app).get('/api/user/getUsers/');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_TOKEN');
    });

    test('Threat Vector 5: Invalid/Spoofed Authorization token must fail closed', async () => {
      const response = await request(app)
        .get('/api/user/getUsers/')
        .set('Authorization', 'Bearer invalid-garbage-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    test('Threat Vector 6: Expired custom JWT token must fail closed', async () => {
      // Generate an expired custom JWT
      const expiredToken = jwt.sign(
        { userId: '507f1f77bcf86cd799439011', email: 'expired@carenest.com', role: 'employee' },
        process.env.JWT_SECRET || 'fallback-secret-at-least-32-chars-long-for-valid-key',
        { expiresIn: '-1h', issuer: 'invoice-app', audience: 'invoice-app-users' }
      );

      const response = await request(app)
        .get('/api/user/getUsers/')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    test('Zero-Trust Success: Correct AppCheck and valid Bearer auth succeeds', async () => {
      process.env.APP_CHECK_ENFORCEMENT = 'true';
      global.mockVerifyAppCheckToken.mockResolvedValue({}); // Valid AppCheck

      // Set up mock user lookup
      global.mockUserFindOne.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'authenticated-user@carenest.com',
        role: 'employee',
        roles: ['employee'],
        organizationId: '507f1f77bcf86cd799439012'
      });

      // Mock Firebase ID token verification
      global.mockVerifyIdToken.mockResolvedValue({
        email: 'authenticated-user@carenest.com',
        role: 'employee',
        roles: ['employee'],
        uid: 'firebase-user-uid',
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600
      });

      const response = await request(app)
        .get('/api/user/getUsers/')
        .set('X-Platform', 'android')
        .set('X-Firebase-AppCheck', 'valid-firebase-appcheck-token')
        .set('Authorization', 'Bearer valid-firebase-id-token');

      // The controller may return 200 or 500 depending on database mock, but it must pass the Security Gate (not return 401)
      expect(response.status).not.toBe(401);
      expect(global.mockVerifyAppCheckToken).toHaveBeenCalledWith('valid-firebase-appcheck-token');
      expect(global.mockVerifyIdToken).toHaveBeenCalledWith('valid-firebase-id-token');
    });
  });
});
