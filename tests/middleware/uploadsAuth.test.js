/**
 * Uploads static-serving authorization tests.
 *
 * /uploads/logos/* stays public (org branding); every other path under
 * /uploads requires a valid bearer token. Filenames are predictable
 * (fieldname-timestamp-random), so anonymous reads would be enumerable.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));

const mockFindOne = jest.fn();
jest.mock('../../models/User', () => ({
  findOne: mockFindOne,
}));

jest.mock('../../services/jwtKeyRotationService', () => ({
  getValidKeys: jest.fn().mockReturnValue([]),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    security: jest.fn(),
  }),
}));

// The app module has no side effects beyond route registration (DB connects
// in server.js), so requiring it in tests is safe.
const app = require('../../app');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const logosDir = path.join(uploadsDir, 'logos');
const publicFixture = path.join(logosDir, '__auth_test_logo.txt');
const privateFixture = path.join(uploadsDir, '__auth_test_private.txt');

describe('uploads static authorization', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    fs.mkdirSync(logosDir, { recursive: true });
    fs.writeFileSync(publicFixture, 'public-logo-fixture');
    fs.writeFileSync(privateFixture, 'private-fixture');

    mockVerifyIdToken.mockResolvedValue({
      uid: 'test-uid',
      email: 'test@example.com',
    });
    mockFindOne.mockResolvedValue({
      _id: 'user-id',
      email: 'test@example.com',
      roles: ['admin'],
      organizationId: 'org-id',
    });
  });

  afterAll(() => {
    process.env = { ...originalEnv };
    for (const f of [publicFixture, privateFixture]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    jest.clearAllMocks();
  });

  test('serves logos without authentication', async () => {
    const res = await request(app).get('/uploads/logos/__auth_test_logo.txt');
    expect(res.status).toBe(200);
    expect(res.text).toBe('public-logo-fixture');
  });

  test('rejects anonymous reads of non-logo uploads with 401', async () => {
    const res = await request(app).get('/uploads/__auth_test_private.txt');
    expect(res.status).toBe(401);
  });

  test('serves non-logo uploads with a valid bearer token', async () => {
    const res = await request(app)
      .get('/uploads/__auth_test_private.txt')
      .set('Authorization', 'Bearer valid-test-token');
    expect(res.status).toBe(200);
    expect(res.text).toBe('private-fixture');
  });

  test('rejects malformed bearer tokens with 401', async () => {
    const res = await request(app)
      .get('/uploads/__auth_test_private.txt')
      .set('Authorization', 'not-a-bearer-token');
    expect(res.status).toBe(401);
  });

  test('blocks path traversal outside uploads', async () => {
    const res = await request(app).get('/uploads/../app.js');
    expect([400, 403, 404]).toContain(res.status);
  });
});
