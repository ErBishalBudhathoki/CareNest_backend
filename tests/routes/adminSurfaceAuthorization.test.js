/**
 * Admin-surface authorization tests.
 *
 * SIL management (`/api/sil/*`), NDIS claiming (`/api/ndis-claims/*`) and the
 * note-template manager (`/api/notes/templates`) are reached from the Admin
 * dashboard only. Those screens live behind navigation, which is not a security
 * boundary: a support worker's token could still call the API directly. These
 * tests pin the server-side role check so the boundary cannot silently regress
 * back to UI-only.
 *
 * Reads of note templates are deliberately open to every member of the
 * organisation (the note composer picks a template), so the write routes are
 * the ones that must reject a non-admin token.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Pin the two token-verification inputs so authentication is deterministic:
// Firebase ID-token verification must always miss (these are custom JWTs) and
// the key-rotation keystore must be empty, which routes verification through
// JWT_SECRET exactly as it does in production when no rotated keys exist.
jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: jest.fn().mockRejectedValue(new Error('not a firebase token')),
  }),
}));
const TEST_JWT_SECRET = 'admin-surface-authorization-test-secret';
jest.mock('../../services/jwtKeyRotationService', () => ({
  getValidKeys: jest
    .fn()
    .mockResolvedValue([{ keyId: 'test-key', secret: 'admin-surface-authorization-test-secret' }]),
}));

// Redis/BullMQ are not available in unit tests; the app imports them at module
// load through the queue modules.
jest.mock('ioredis', () => require('ioredis-mock'));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), on: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('rate-limit-redis', () => ({
  RedisStore: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  })),
}));

jest.mock('../../config/redis', () => ({
  call: jest.fn(),
  on: jest.fn(),
  status: 'ready',
  quit: jest.fn(),
  disconnect: jest.fn(),
  duplicate: jest.fn().mockReturnThis(),
  subscribe: jest.fn(),
  publish: jest.fn(),
}));

// The in-memory anti-bruteforce IP block would otherwise accumulate failed
// attempts from the anonymous/unauthenticated cases below and start returning
// 429 for later requests in the same file.
jest.mock('../../utils/securityMonitor', () => ({
  securityMonitor: {
    recordAuthFailure: jest.fn(),
    recordAuthSuccess: jest.fn(),
    logSecurityEvent: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
  },
}));

// Membership lookup used by organizationContext / rbac middleware. The admin
// token gets an owner membership, the employee token an employee membership,
// so the surface gate can be asserted against both without a live database.
const ADMIN_USER_ID = '507f1f77bcf86cd799439099';
jest.mock('../../models/UserOrganization', () => {
  function buildQuery(value) {
    return {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(value),
      then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
      catch: (fn) => Promise.resolve(value).catch(fn),
    };
  }
  return {
    findOne: jest.fn((query) =>
      buildQuery(
        query && String(query.userId) === '507f1f77bcf86cd799439099'
          ? { _id: 'uo-admin', role: 'owner', permissions: ['*'], isActive: true }
          : { _id: 'uo-1', role: 'employee', permissions: [], isActive: true }
      )
    ),
    find: jest.fn(() => buildQuery([])),
    db: { readyState: 1 },
  };
});

const app = require('../../app');

const ORG_ID = '507f1f77bcf86cd799439012';

function makeToken({ email, roles, userId = '507f1f77bcf86cd799439011' }) {
  return jwt.sign(
    {
      userId,
      email,
      roles,
      organizationId: ORG_ID,
    },
    process.env.JWT_SECRET,
    { issuer: 'invoice-app', audience: 'invoice-app-users', expiresIn: '1h' }
  );
}

const employeeToken = () =>
  makeToken({ email: 'employee@example.com', roles: ['employee'] });
const clientToken = () =>
  makeToken({ email: 'client@example.com', roles: ['client'] });
const adminToken = () =>
  makeToken({
    email: 'admin@example.com',
    roles: ['admin'],
    userId: ADMIN_USER_ID,
  });

const withToken = (req, token) =>
  req.set('Authorization', `Bearer ${token}`).set('x-organization-id', ORG_ID);

// Each entry is a request the admin surfaces own. `expectDenied` marks the ones
// a support-worker token must not reach.
const adminOnlyRequests = [
  ['GET', '/api/sil/properties'],
  ['POST', '/api/sil/properties'],
  ['GET', `/api/sil/properties/${ORG_ID}/vacancies`],
  ['GET', '/api/sil/occupancy'],
  ['GET', '/api/sil/ratio-rules'],
  ['GET', `/api/sil/rosters?propertyId=${ORG_ID}&weekStarting=2026-10-19`],
  ['POST', '/api/sil/rosters'],
  ['POST', `/api/sil/rosters/${ORG_ID}/publish`],
  ['GET', '/api/sil/quotes'],
  ['POST', '/api/sil/quotes'],
  ['GET', '/api/sil/rosters-of-care'],
  ['GET', '/api/ndis-claims/batches'],
  ['POST', '/api/ndis-claims/generate'],
  ['GET', `/api/ndis-claims/batches/${ORG_ID}`],
  ['POST', `/api/ndis-claims/batches/${ORG_ID}/results/import`],
  ['POST', '/api/notes/templates'],
  ['PUT', `/api/notes/templates/${ORG_ID}`],
  ['DELETE', `/api/notes/templates/${ORG_ID}`],

  // Advanced payroll: organisation-wide payroll work is admin-only. The
  // payslip read is the deliberate exception and is asserted separately below.
  ['POST', '/api/payroll-advanced/calculate'],
  ['POST', '/api/payroll-advanced/generate-payslips'],
  ['GET', `/api/payroll-advanced/summary/${ORG_ID}/2026-09`],
  ['POST', '/api/payroll-advanced/export'],

  // Financial intelligence is organisation-wide analytics.
  ['GET', `/api/financial-intelligence/revenue/trends/${ORG_ID}`],
  ['POST', '/api/financial-intelligence/revenue/forecast'],
  ['GET', `/api/financial-intelligence/analytics/kpis/${ORG_ID}`],
  ['GET', `/api/financial-intelligence/billing/pending/${ORG_ID}`],

  // The organisation invoice profile carries the bank account invoices are
  // paid into.
  ['GET', `/api/admin-invoice-profile/api/admin-invoice-profile/${ORG_ID}`],
  ['POST', '/api/admin-invoice-profile/api/admin-invoice-profile'],
  ['PUT', `/api/admin-invoice-profile/api/admin-invoice-profile/${ORG_ID}`],

  // Bulk actions that change the whole organisation.
  ['POST', '/api/bulk/approve-timesheets'],
  ['POST', '/api/bulk/reject-timesheets'],
  ['POST', '/api/bulk/generate-invoices'],
  ['POST', '/api/bulk/preview-invoices'],
  ['POST', '/api/bulk/assign-shifts'],
  ['POST', '/api/bulk/send-messages'],
  ['POST', '/api/bulk/schedule-messages'],
];

// Requests that must stay reachable for a non-admin member. These are the
// self-service exceptions; if one of them starts returning 403 the fix has gone
// too far and broken an employee's own screen.
const memberReachableRequests = [
  // An employee reads their own payslip. The caller id matches the requested id.
  ['GET', '/api/payroll-advanced/payslip/507f1f77bcf86cd799439011/2026-09'],
];

// Requests a non-admin member must NOT reach even though they are not
// org-wide: a colleague's payslip.
const colleagueOnlyRequests = [
  ['GET', '/api/payroll-advanced/payslip/507f1f77bcf86cd799439013/2026-09'],
];

// Phase 2: the generation engine behind "Invoice Operations" and the
// AI / price-prompt / invoice-email helpers were authenticated by the global
// gate but had no role check. Some of them read organizationId straight from
// the body, so an employee token could also cross tenants. These assertions
// pin the router-level gate; the admin cases use endpoints that fail input
// validation before touching the database.
const financialSurfaceRequests = [
  ['POST', '/api/invoice/generate-line-items'],
  ['POST', '/api/invoice-ai/validate'],
  ['POST', '/api/invoice-ai/detect-anomalies'],
  ['POST', '/api/sendInvoiceEmail'],
];

// Write paths are asserted for non-admin tokens only: the role gate must
// short-circuit before any controller reaches MongoDB.
const financialWriteRequests = [
  ['POST', '/api/invoice-ai/auto-generate'],
  ['POST', '/api/invoice-ai/generate-from-text'],
  ['POST', '/api/invoice/bulk-generate'],
  ['POST', '/api/invoice/price-prompt/create'],
  ['POST', '/api/invoice/generate-with-prompts'],
  ['POST', '/api/invoice/complete-generation'],
  ['GET', '/api/invoice/price-prompt/pending/session-1'],
];

// Phase 2 (NDIS configuration): price caps, the NDIS catalogue, approvals and
// participant plan budgets decide whether an invoice or claim line is allowed
// and for how much. They sit under "Configuration & Finance" but previously had
// only authentication + membership, so any employee token could rewrite them.
// Read-only price lookups (including the POST /bulk-lookup) must stay open.
const configurationWriteRequests = [
  ['POST', '/api/pricing/create'],
  ['PUT', '/api/pricing/p1'],
  ['DELETE', '/api/pricing/p1'],
  ['PUT', '/api/pricing/p1/approval'],
  ['POST', '/api/pricing/bulk-import'],
  ['PUT', `/api/pricing/fallback-base-rate/${ORG_ID}`],
  ['PUT', `/api/client/${ORG_ID}/plan`],
];

const configurationReadRequests = [
  ['GET', '/api/pricing/support-items'],
  ['POST', '/api/pricing/bulk-lookup'],
];

// Supertest's `request(app)` spins up and tears down an ephemeral listener per
// call. With ~40 calls in this file that occasionally reuses a port still in
// TIME_WAIT and fails with "socket hang up"/a header-less request. One listener
// for the whole file keeps the assertions testing middleware, not TCP.
let server;
let baseUrl;

const send = (method, path, token) => {
  const req = request(baseUrl)[method.toLowerCase()](path);
  return withToken(req, token);
};

describe('admin-surface API authorization', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll((done) => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    process.env.JWT_SECRET = originalSecret;
    server.close(done);
  });

  test('rejects anonymous access with 401', async () => {
    const res = await request(baseUrl).get('/api/sil/properties');
    expect(res.status).toBe(401);
  });

  describe.each(adminOnlyRequests)('%s %s', (method, path) => {
    test('employee token is denied with 403 INSUFFICIENT_PERMISSIONS', async () => {
      const res = await send(method, path, employeeToken());
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('admin token is not denied by the role gate', async () => {
      const res = await send(method, path, adminToken());
      expect(res.status).not.toBe(403);
      expect(res.body?.code).not.toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  test('employee token can still read note templates (note composer)', async () => {
    const res = await send('GET', '/api/notes/templates', employeeToken());
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe('INSUFFICIENT_PERMISSIONS');
  });

  describe.each(memberReachableRequests)('%s %s', (method, path) => {
    test('employee token is not refused', async () => {
      const res = await send(method, path, employeeToken());
      expect(res.status).not.toBe(403);
    });
  });

  describe.each(colleagueOnlyRequests)('%s %s', (method, path) => {
    test('employee token is refused for another employee', async () => {
      const res = await send(method, path, employeeToken());
      expect(res.status).toBe(403);
    });
  });

  test('employee token cannot list SIL data through an aliased path', async () => {
    // Guards against the role check being attached per-route and missed on a
    // later addition: every method on the router subtree must be covered.
    const res = await send('GET', '/api/sil/rosters-of-care', employeeToken());
    expect(res.status).toBe(403);
  });

  describe.each(financialSurfaceRequests)('%s %s', (method, path) => {
    test('employee and client tokens are denied with 403 INSUFFICIENT_PERMISSIONS', async () => {
      for (const token of [employeeToken(), clientToken()]) {
        const res = await send(method, path, token);
        expect(res.status).toBe(403);
        expect(res.body?.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });

    test('admin token is not denied by the role gate', async () => {
      const res = await send(method, path, adminToken());
      expect(res.status).not.toBe(403);
      expect(res.body?.code).not.toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe.each(financialWriteRequests)('%s %s', (method, path) => {
    test('non-admin tokens are refused before the controller runs', async () => {
      for (const token of [employeeToken(), clientToken()]) {
        const res = await send(method, path, token);
        expect(res.status).toBe(403);
        expect(res.body?.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });
  });

  test('an admin token cannot auto-generate invoices for another organisation', async () => {
    // The active-org header and the body must agree. A contradictory body id
    // is rejected by requireOrgMembership before any invoice can be created;
    // requireMatchingOrganization is the second line of defence and is covered
    // separately in tests/middleware/adminSurface.test.js.
    const res = await send('POST', '/api/invoice-ai/auto-generate', adminToken())
      .send({ organizationId: '507f1f77bcf86cd799439013' });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('ORG_ID_CONFLICT');
  });

  describe.each(configurationWriteRequests)('%s %s', (method, path) => {
    test('non-admin tokens cannot rewrite NDIS pricing or plan budgets', async () => {
      for (const token of [employeeToken(), clientToken()]) {
        const res = await send(method, path, token);
        expect(res.status).toBe(403);
        expect(res.body?.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });
  });

  describe.each(configurationReadRequests)('%s %s', (method, path) => {
    test('read-only pricing lookups stay available to employees', async () => {
      const res = await send(method, path, employeeToken());
      expect(res.status).not.toBe(403);
      expect(res.body?.code).not.toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  test('an admin cannot configure pricing for a different organisation', async () => {
    // requireMatchingOrganization pins the body org to the validated
    // membership; requireOrgMembership rejects the contradiction first.
    const res = await send('POST', '/api/pricing/create', adminToken())
      .send({ organizationId: '507f1f77bcf86cd799439013' });
    expect([400, 403]).toContain(res.status);
    expect(['ORG_ID_CONFLICT', 'ORGANIZATION_MISMATCH']).toContain(res.body?.code);
  });
});
