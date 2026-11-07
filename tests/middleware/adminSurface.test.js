/**
 * Regression tests for the server-side admin financial-surface gate.
 *
 * The Admin -> Employee mode switch in the Flutter app only changes local
 * state; it never reissues the credential. These tests pin the fact that
 * authorization is derived from the server-verified token AND the resolved
 * organisation membership, not from a client-supplied role or org id.
 */
jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    security: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const {
  requireAdminSurface,
  requireMatchingOrganization,
  requireMatchingOrganizationNoBodyPin,
} = require('../../middleware/adminSurface');

const ORG_A = '507f1f77bcf86cd799439001';
const ORG_B = '507f1f77bcf86cd799439002';

function makeReq({
  roles = ['employee'],
  role,
  membershipRole = 'admin',
  organizationId = ORG_A,
  withContext = true,
  body = {},
  query = {},
  params = {},
  headers = {},
} = {}) {
  const req = {
    user: { userId: 'u1', email: 'u@example.com', roles, role, organizationId: ORG_A },
    body: { ...body },
    query: { ...query },
    params: { ...params },
    headers: { ...headers },
    originalUrl: '/api/invoice-ai/auto-generate',
    path: '/auto-generate',
    ip: '127.0.0.1',
  };
  if (withContext) {
    req.organizationContext = {
      organizationId,
      userRole: membershipRole,
      isAdmin: ['admin', 'owner'].includes(membershipRole),
    };
  }
  return req;
}

function makeRes() {
  const res = { statusCode: 200, payload: null };
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

describe('requireAdminSurface', () => {
  test.each([
    ['employee', ['employee']],
    ['client', ['client']],
    ['family', ['family']],
    ['no roles', []],
  ])('denies a %s token with INSUFFICIENT_PERMISSIONS', (_label, roles) => {
    const req = makeReq({ roles });
    const res = makeRes();
    const next = jest.fn();
    requireAdminSurface(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  test.each(['admin', 'owner', 'manager', 'superadmin', 'moderator'])(
    'allows an admin-equivalent token role (%s)',
    (tag) => {
      const req = makeReq({ roles: [tag], membershipRole: 'admin' });
      const res = makeRes();
      const next = jest.fn();
      requireAdminSurface(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    },
  );

  test('honours a singular req.user.role when roles is absent', () => {
    const req = makeReq({ roles: [], role: 'owner' });
    const res = makeRes();
    const next = jest.fn();
    requireAdminSurface(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('denies an admin of org A acting as an employee of org B', () => {
    // Dual membership is the escalation the membership check exists for.
    const req = makeReq({
      roles: ['admin'],
      membershipRole: 'employee',
      organizationId: ORG_B,
    });
    const res = makeRes();
    const next = jest.fn();
    requireAdminSurface(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('denies an unauthenticated request', () => {
    const req = makeReq();
    delete req.user;
    const res = makeRes();
    const next = jest.fn();
    requireAdminSurface(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('ignores a client-supplied admin role in the body, query or headers', () => {
    // The Admin -> Employee mode switch only flips local state. A forged
    // client-side "admin" hint must not be able to buy API permissions.
    const req = makeReq({
      roles: ['employee'],
      body: { role: 'admin', roles: ['admin'] },
      query: { role: 'admin' },
      headers: { 'x-user-role': 'admin' },
    });
    const res = makeRes();
    const next = jest.fn();
    requireAdminSurface(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('requireMatchingOrganization', () => {
  test('rejects a body organisation that differs from the validated context', () => {
    const req = makeReq({ body: { organizationId: ORG_B } });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganization(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('ORGANIZATION_MISMATCH');
  });

  test('rejects a mismatching x-organization-id header', () => {
    const req = makeReq({ headers: { 'x-organization-id': ORG_B } });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganization(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('rejects a mismatching query or route parameter', () => {
    for (const extra of [{ query: { organizationId: ORG_B } }, { params: { organizationId: ORG_B } }]) {
      const req = makeReq(extra);
      const res = makeRes();
      const next = jest.fn();
      requireMatchingOrganization(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });

  test('pins req.body.organizationId to the validated organisation', () => {
    const req = makeReq({ body: { startDate: '2026-10-01' } });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganization(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.organizationId).toBe(ORG_A);
    expect(req.body.startDate).toBe('2026-10-01');
  });

  test('accepts a matching explicit organisation', () => {
    const req = makeReq({
      body: { organizationId: ORG_A },
      headers: { 'x-organization-id': ORG_A },
    });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganization(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('is inert when no organisation context was resolved', () => {
    const req = makeReq({ withContext: false, body: { organizationId: ORG_B } });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganization(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireMatchingOrganizationNoBodyPin', () => {
  // `PUT /organization/:organizationId` does `$set: req.body`. Pinning the body
  // would silently add an `organizationId` field to the stored document.
  test('leaves the raw update payload byte-for-byte untouched', () => {
    const body = { bankDetails: { bsb: '000-000' }, contactDetails: { phone: '1' } };
    const req = makeReq({ body, params: { organizationId: ORG_A } });
    const before = JSON.stringify(req.body);
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganizationNoBodyPin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(req.body)).toBe(before);
    expect(req.body).not.toHaveProperty('organizationId');
  });

  test('still rejects a path organisation that differs from the validated context', () => {
    const req = makeReq({
      roles: ['admin'],
      params: { organizationId: ORG_B },
    });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganizationNoBodyPin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('ORGANIZATION_MISMATCH');
  });

  test('still rejects a conflicting x-organization-id header', () => {
    const req = makeReq({
      roles: ['admin'],
      headers: { 'x-organization-id': ORG_B },
      params: { organizationId: ORG_A },
    });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganizationNoBodyPin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('accepts matching header and path without changing the body', () => {
    const req = makeReq({
      roles: ['admin'],
      headers: { 'x-organization-id': ORG_A },
      params: { organizationId: ORG_A },
      body: { tradingName: 'CareNest' },
    });
    const res = makeRes();
    const next = jest.fn();
    requireMatchingOrganizationNoBodyPin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ tradingName: 'CareNest' });
  });
});
