const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Ensure essential env vars are set
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Activate Manual Mocks
jest.mock('ioredis');
jest.mock('firebase-admin');
jest.mock('mongoose');
jest.mock('mongodb');

// Mock rate-limit-redis (Inline because it's simple)
jest.mock('rate-limit-redis', () => {
  return {
      RedisStore: class RedisStore {
          constructor() {}
          init() {}
          increment() { return Promise.resolve({ totalHits: 1, resetTime: new Date() }); }
          decrement() {}
          resetKey() {}
      }
  }
});

// Mock Google Vertex AI (Scoped package)
jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          candidates: [{ content: { parts: [{ text: '{}' }] } }]
        }
      })
    })
  }))
}));

// Suppress logs (except during debugging)
if (process.env.JEST_DEBUG === 'true') {
  console.log('DEBUG MODE ENABLED');
} else {
  global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}
