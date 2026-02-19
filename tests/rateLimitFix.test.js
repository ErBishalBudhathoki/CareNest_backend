
const { rateLimitMiddleware } = require('../middleware/auth');
const { RedisStore } = require('rate-limit-redis');

// Mock rate-limit-redis
jest.mock('rate-limit-redis', () => {
  return {
    RedisStore: jest.fn().mockImplementation(() => ({
      init: jest.fn(),
      increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
      decrement: jest.fn(),
      resetKey: jest.fn(),
    })),
  };
});

// Mock other dependencies
jest.mock('../config/redis', () => ({
  call: jest.fn(),
  on: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  createLogger: () => ({
    security: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

describe('Rate Limit Configuration', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    RedisStore.mockClear();
    // Temporarily set NODE_ENV to something else to enable RedisStore
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should initialize RedisStore with unique prefix for "login"', () => {
    rateLimitMiddleware('login');
    
    expect(RedisStore).toHaveBeenCalledTimes(1);
    const config = RedisStore.mock.calls[0][0];
    expect(config).toHaveProperty('prefix', 'rl:login:');
  });

  it('should initialize RedisStore with unique prefix for "verify"', () => {
    rateLimitMiddleware('verify');
    
    expect(RedisStore).toHaveBeenCalledTimes(1);
    const config = RedisStore.mock.calls[0][0];
    expect(config).toHaveProperty('prefix', 'rl:verify:');
  });

  it('should initialize RedisStore with unique prefix for "register"', () => {
    rateLimitMiddleware('register');
    
    expect(RedisStore).toHaveBeenCalledTimes(1);
    const config = RedisStore.mock.calls[0][0];
    expect(config).toHaveProperty('prefix', 'rl:register:');
  });
});
