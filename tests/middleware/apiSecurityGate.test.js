const mockAuthenticateUser = jest.fn();
const mockRequireAppCheck = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authenticateUser: mockAuthenticateUser,
}));

jest.mock('../../middleware/appCheck', () => ({
  requireAppCheck: mockRequireAppCheck,
}));

const { apiSecurityGate } = require('../../middleware/apiSecurityGate');

function createReq({ path = '/api/communication-hub/templates', method = 'GET' } = {}) {
  return {
    method,
    path,
    originalUrl: path,
  };
}

function createRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('apiSecurityGate', () => {
  let res;
  let next;

  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockRequireAppCheck.mockReset();
    res = createRes();
    next = jest.fn();
  });

  test('bypasses public auth endpoints', () => {
    const req = createReq({ path: '/api/auth/login', method: 'POST' });

    apiSecurityGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRequireAppCheck).not.toHaveBeenCalled();
    expect(mockAuthenticateUser).not.toHaveBeenCalled();
  });

  test('bypasses firebase auth bootstrap endpoints', () => {
    const req = createReq({ path: '/api/firebase-auth/sync', method: 'POST' });

    apiSecurityGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRequireAppCheck).not.toHaveBeenCalled();
    expect(mockAuthenticateUser).not.toHaveBeenCalled();
  });

  test('bypasses scheduler endpoints that use cloud scheduler auth', () => {
    const req = createReq({ path: '/api/scheduler/daily', method: 'POST' });

    apiSecurityGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRequireAppCheck).not.toHaveBeenCalled();
    expect(mockAuthenticateUser).not.toHaveBeenCalled();
  });

  test('bypasses CORS preflight requests', () => {
    const req = createReq({ path: '/api/communication-hub/templates', method: 'OPTIONS' });

    apiSecurityGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRequireAppCheck).not.toHaveBeenCalled();
    expect(mockAuthenticateUser).not.toHaveBeenCalled();
  });

  test('enforces app check before bearer auth for protected api routes', () => {
    const req = createReq();
    mockRequireAppCheck.mockImplementation((_req, _res, appCheckNext) => appCheckNext());

    apiSecurityGate(req, res, next);

    expect(mockRequireAppCheck).toHaveBeenCalledWith(req, res, expect.any(Function));
    expect(mockAuthenticateUser).toHaveBeenCalledWith(req, res, next);
  });

  test('stops before bearer auth when app check rejects the request', () => {
    const req = createReq();

    apiSecurityGate(req, res, next);

    expect(mockRequireAppCheck).toHaveBeenCalledTimes(1);
    expect(mockAuthenticateUser).not.toHaveBeenCalled();
  });
});
