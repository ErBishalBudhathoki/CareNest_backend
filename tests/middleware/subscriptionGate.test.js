/**
 * Subscription gate tests: unpaid orgs get 402 on paid feature groups
 * (including AI endpoints), setup/auth routes stay open, and the whole
 * gate is inert unless ENTITLEMENT_GATE=true.
 */
const mockOrgFindById = jest.fn();
jest.mock('../../models/Organization', () => ({
  findById: (...args) => mockOrgFindById(...args),
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const {
  subscriptionGate,
  BLOCKED_PREFIXES,
} = require('../../middleware/billing/subscriptionGate');

function req(path, orgId = 'org-a') {
  return {
    originalUrl: path,
    path,
    organizationContext: { organizationId: orgId },
    user: { userId: 'u1', organizationId: orgId },
    body: {},
    query: {},
    ip: '1.1.1.1',
  };
}

function res() {
  const r = {};
  r.statusCode = 200;
  r.payload = null;
  r.status = jest.fn((c) => {
    r.statusCode = c;
    return r;
  });
  r.json = jest.fn((p) => {
    r.payload = p;
    return r;
  });
  return r;
}

describe('subscriptionGate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENTITLEMENT_GATE = 'true';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('AI endpoints are a blocked paid group', () => {
    expect(BLOCKED_PREFIXES).toContain('/api/care-intelligence');
  });

  test('passes unpaid check through when the flag is off (safe default)', async () => {
    process.env.ENTITLEMENT_GATE = 'false';
    const next = jest.fn();
    await subscriptionGate(
      req('/api/care-intelligence/intelligence/report/x'),
      res(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockOrgFindById).not.toHaveBeenCalled();
  });

  test('blocks unpaid org on AI endpoint with 402', async () => {
    mockOrgFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ subscription: { status: 'none' } }),
    });
    const next = jest.fn();
    const r = res();
    await subscriptionGate(
      req('/api/care-intelligence/intelligence/report/x'),
      r,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(402);
    expect(r.payload.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  test('allows active org on AI endpoint', async () => {
    mockOrgFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ subscription: { status: 'active' } }),
    });
    const next = jest.fn();
    await subscriptionGate(
      req('/api/care-intelligence/intelligence/report/x'),
      res(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('allows grace/billing_retry statuses', async () => {
    for (const status of ['grace', 'billing_retry']) {
      jest.clearAllMocks();
      mockOrgFindById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ subscription: { status } }),
      });
      const next = jest.fn();
      await subscriptionGate(req('/api/invoices'), res(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  test('leaves setup/auth routes open even when unpaid', async () => {
    mockOrgFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ subscription: { status: 'none' } }),
    });
    const next = jest.fn();
    await subscriptionGate(req('/api/auth/login'), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockOrgFindById).not.toHaveBeenCalled();
  });
});
