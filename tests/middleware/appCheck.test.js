const mockVerifyToken = jest.fn();
const mockAppCheck = jest.fn(() => ({ verifyToken: mockVerifyToken }));

jest.mock('../../firebase-admin-config', () => ({
  admin: {
    appCheck: mockAppCheck,
  },
}));

const { requireAppCheck, isAppCheckEnforced } = require('../../middleware/appCheck');

function createReq(token, platform = 'android') {
  return {
    header: jest.fn((name) => {
      if (name === 'X-Firebase-AppCheck') return token;
      if (name === 'X-Platform') return platform;
      return undefined;
    }),
    originalUrl: '/api/auth/forgot-password',
    method: 'POST',
  };
}

function createRes() {
  const res = {};
  res.statusCode = 200;
  res.payload = null;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });
  return res;
}

describe('App Check middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    delete process.env.APP_CHECK_ENFORCEMENT;
    delete process.env.APP_CHECK_DEBUG_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('is disabled in test environment', () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_CHECK_ENFORCEMENT = 'true';
    expect(isAppCheckEnforced()).toBe(false);
  });

  test('defaults to enabled in production when flag is omitted', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_CHECK_ENFORCEMENT;
    expect(isAppCheckEnforced()).toBe(true);
  });

  test('skips App Check for iOS platform', async () => {
    process.env.APP_CHECK_ENFORCEMENT = 'true';

    const req = createReq(undefined, 'ios');
    const res = createRes();
    const next = jest.fn();

    await requireAppCheck(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test('skips App Check for iOS platform regardless of case', async () => {
    process.env.APP_CHECK_ENFORCEMENT = 'true';

    const req = createReq(undefined, 'iOS');
    const res = createRes();
    const next = jest.fn();

    await requireAppCheck(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test('returns 401 when token is missing and enforcement is enabled', async () => {
    process.env.APP_CHECK_ENFORCEMENT = 'true';

    const req = createReq(undefined, 'android');
    const res = createRes();
    const next = jest.fn();

    await requireAppCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload?.errorCode).toBe('MISSING_APP_CHECK_TOKEN');
  });

  test('allows request with debug token when configured', async () => {
    process.env.APP_CHECK_ENFORCEMENT = 'true';
    process.env.APP_CHECK_DEBUG_TOKEN = 'debug-token';

    const req = createReq('debug-token', 'android');
    const res = createRes();
    const next = jest.fn();

    await requireAppCheck(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  test('verifies token with Firebase Admin when provided', async () => {
    process.env.APP_CHECK_ENFORCEMENT = 'true';
    mockVerifyToken.mockResolvedValueOnce({ sub: 'app-id' });

    const req = createReq('valid-token', 'android');
    const res = createRes();
    const next = jest.fn();

    await requireAppCheck(req, res, next);

    expect(mockAppCheck).toHaveBeenCalledTimes(1);
    expect(mockVerifyToken).toHaveBeenCalledWith('valid-token');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 401 for invalid token', async () => {
    process.env.APP_CHECK_ENFORCEMENT = 'true';
    mockVerifyToken.mockRejectedValueOnce(new Error('invalid token'));

    const req = createReq('bad-token', 'android');
    const res = createRes();
    const next = jest.fn();

    await requireAppCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload?.errorCode).toBe('INVALID_APP_CHECK_TOKEN');
  });
});
