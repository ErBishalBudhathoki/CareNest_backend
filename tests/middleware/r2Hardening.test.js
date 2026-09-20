/**
 * R2 hardening tests: proxy URL builder, custom-domain allowlist, and the
 * user-photo endpoint's org-aware IDOR guard.
 */
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => params),
  PutObjectCommand: jest.fn((params) => params),
}));

const mockAuthGetUserPhoto = jest.fn();
jest.mock('../../services/authService', () => ({
  getUserPhoto: (...args) => mockAuthGetUserPhoto(...args),
}));

const mockUserFindOne = jest.fn();
jest.mock('../../models/User', () => ({
  findOne: (...args) => mockUserFindOne(...args),
}));

const mockUserOrgFindOne = jest.fn();
jest.mock('../../models/UserOrganization', () => ({
  findOne: (...args) => mockUserOrgFindOne(...args),
}));

const mockVerifyIdToken = jest.fn();
jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
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
  business: jest.fn(),
}));

const {
  buildFileProxyUrl,
  isAllowedR2Host,
} = require('../../controllers/fileController');
const AuthController = require('../../controllers/authController');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.payload = null;
  res.headers = {};
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  res.send = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  res.set = jest.fn((k, v) => {
    res.headers[k] = v;
    return res;
  });
  return res;
}

describe('fileController R2 helpers', () => {
  const req = { protocol: 'https', get: () => 'api.example.com' };

  test('buildFileProxyUrl points at the authenticated download endpoint', () => {
    const out = buildFileProxyUrl(
      req,
      'https://acct.r2.cloudflarestorage.com/bucket/receipts/a.jpg',
    );
    expect(out).toBe(
      'https://api.example.com/api/files/download?url=' +
        encodeURIComponent(
          'https://acct.r2.cloudflarestorage.com/bucket/receipts/a.jpg',
        ),
    );
  });

  test('allows R2 API hosts and the configured custom domain only', () => {
    expect(isAllowedR2Host('acct.r2.cloudflarestorage.com')).toBe(true);
    expect(isAllowedR2Host('bucket.acct.r2.cloudflarestorage.com')).toBe(true);
    expect(isAllowedR2Host('evil.com')).toBe(false);
    process.env.R2_PUBLIC_DOMAIN = 'cdn.example.com';
    expect(isAllowedR2Host('cdn.example.com')).toBe(true);
    expect(isAllowedR2Host('other.example.com')).toBe(false);
    delete process.env.R2_PUBLIC_DOMAIN;
  });
});

describe('getUserPhoto IDOR guard', () => {
  const ownerEmail = 'owner@example.com';

  // catchAsync handlers are fire-and-forget ((req,res,next) => ... with no
  // returned promise), so direct unit invocations must flush the event
  // loop before asserting — otherwise assertions race the handler.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  const photoReq = (email, user) => ({
    params: { email },
    user,
    ip: '1.1.1.1',
    get: jest.fn(),
  });

  const selfUser = {
    userId: 'u-self',
    email: ownerEmail,
    roles: ['member'],
    organizationId: 'org-a',
  };
  const adminUser = {
    userId: 'u-admin',
    email: 'admin@example.com',
    roles: ['admin'],
    organizationId: 'org-a',
  };
  const teammateUser = {
    userId: 'u-team',
    email: 'team@example.com',
    roles: ['member'],
    organizationId: 'org-a',
  };
  const outsiderUser = {
    userId: 'u-out',
    email: 'out@example.com',
    roles: ['member'],
    organizationId: 'org-b',
  };

  beforeAll(() => {
    process.env.R2_ACCOUNT_ID = 'test-acct';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET_NAME = 'test-bucket';
  });

  afterAll(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGetUserPhoto.mockResolvedValue({
      url: 'https://test-acct.r2.cloudflarestorage.com/test-bucket/profileImage/p.jpg',
    });
    mockUserFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ organizationId: 'org-a' }),
    });
    mockUserOrgFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    async function* chunks() {
      yield Buffer.from('img-bytes');
    }
    mockS3Send.mockResolvedValue({
      ContentType: 'image/jpeg',
      ContentLength: 9,
      Body: { [Symbol.asyncIterator]: chunks },
    });
  });

  test('serves the caller own photo', async () => {
    const res = mockRes();
    await AuthController.getUserPhoto(photoReq(ownerEmail, selfUser), res);
    await flush();
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(Buffer.from('img-bytes'));
  });

  test('serves teammate photo within the same org', async () => {
    const res = mockRes();
    await AuthController.getUserPhoto(photoReq(ownerEmail, teammateUser), res);
    await flush();
    expect(res.statusCode).toBe(200);
  });

  test('serves any photo to admin', async () => {
    const res = mockRes();
    await AuthController.getUserPhoto(photoReq(ownerEmail, adminUser), res);
    await flush();
    expect(res.statusCode).toBe(200);
  });

  test('rejects cross-org photo with 403 without touching R2', async () => {
    const res = mockRes();
    await AuthController.getUserPhoto(photoReq(ownerEmail, outsiderUser), res);
    await flush();
    expect(res.statusCode).toBe(403);
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});
