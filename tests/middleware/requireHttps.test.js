const { requireHttps } = require('../../middleware/requireHttps');

function createReq({ secure = false, path = '/api/test' } = {}) {
  return { secure, path, method: 'GET' };
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

describe('requireHttps middleware', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  test('passes through insecure requests outside production', () => {
    process.env.NODE_ENV = 'development';
    const next = jest.fn();
    requireHttps(createReq({ secure: false }), createRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes secure requests in production', () => {
    process.env.NODE_ENV = 'production';
    const next = jest.fn();
    requireHttps(createReq({ secure: true }), createRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects plaintext requests in production with 426', () => {
    process.env.NODE_ENV = 'production';
    const next = jest.fn();
    const res = createRes();
    requireHttps(createReq({ secure: false }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(426);
    expect(res.payload.success).toBe(false);
  });

  test('exempts platform health probes in production', () => {
    process.env.NODE_ENV = 'production';
    for (const path of ['/health', '/api/health']) {
      const next = jest.fn();
      requireHttps(createReq({ secure: false, path }), createRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  test('treats missing req.secure as insecure in production', () => {
    process.env.NODE_ENV = 'production';
    const next = jest.fn();
    const res = createRes();
    requireHttps({ path: '/api/test', method: 'GET' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(426);
  });
});
