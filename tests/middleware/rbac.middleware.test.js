const mockFindOne = jest.fn();

jest.mock('../../models/UserOrganization', () => ({
  db: { readyState: 0 },
  findOne: mockFindOne,
}));

const { requireAdmin } = require('../../middleware/rbac');

function createRes(done, assertions) {
  const res = {};
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    try {
      assertions(res.statusCode, payload);
      done();
    } catch (error) {
      done(error);
    }
    return res;
  });
  return res;
}

describe('RBAC middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requireAdmin returns 403 (not throw) when org DB is disconnected', (done) => {
    const req = {
      user: {
        userId: '507f1f77bcf86cd799439011',
        email: 'employee@example.com',
        roles: ['employee'],
        role: 'user',
        organizationId: '507f1f77bcf86cd799439012',
      },
      params: {},
      body: {},
      query: {},
    };

    const res = createRes(done, (statusCode, payload) => {
      expect(statusCode).toBe(403);
      expect(payload).toEqual({
        success: false,
        message: 'Admin access required',
      });
      expect(mockFindOne).not.toHaveBeenCalled();
    });

    const next = jest.fn((error) => {
      done(error || new Error('next() should not be called for this request'));
    });

    requireAdmin(req, res, next);
  });
});
