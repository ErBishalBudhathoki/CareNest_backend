/**
 * Bulk async route tests: ?async=true starts a deterministic workflow
 * (202 + workflowId), duplicates collapse, sync path delegates to the
 * service, and job polling is org-scoped.
 */
const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
jest.mock('../../firebase-admin-config', () => ({
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));

const mockUserFindOne = jest.fn();
jest.mock('../../models/User', () => ({
  findOne: (...args) => mockUserFindOne(...args),
}));

const mockUserOrgFindOne = jest.fn();
jest.mock('../../models/UserOrganization', () => ({
  findOne: (...args) => mockUserOrgFindOne(...args),
}));

const mockStartWorkflow = jest.fn();
const mockDescribeWorkflow = jest.fn();
jest.mock('../../core/TemporalManager', () => ({
  startWorkflow: (...args) => mockStartWorkflow(...args),
  describeWorkflow: (...args) => mockDescribeWorkflow(...args),
  getTaskQueue: () => 'default-dev',
}));

const mockGenerate = jest.fn();
jest.mock('../../services/bulkInvoiceService', () => ({
  generateInvoicesFromAppointments: (...args) => mockGenerate(...args),
  bulkInvoicesWorkflowId: jest.fn((org, ids) => `bulk-invoices-${org}-hash`),
  NoEligibleAppointmentsError: class extends Error {
    constructor() {
      super('No eligible appointments found for invoicing');
      this.statusCode = 404;
    }
  },
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
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const makeApp = () => {
  const t = express();
  t.use(express.json());
  // eslint-disable-next-line global-require
  t.use('/bulk', require('../../routes/bulkActionsRoutes'));
  return t;
};

describe('bulk generate-invoices async', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'u', email: 'a@x.com' });
    mockUserFindOne.mockResolvedValue({
      _id: 'u1',
      email: 'a@x.com',
      roles: ['admin'],
      organizationId: 'org-a',
      lastActiveOrganizationId: 'org-a',
    });
    mockUserOrgFindOne.mockImplementation((query) =>
      query &&
      query.userId === 'u1' &&
      query.organizationId === 'org-a' &&
      query.isActive
        ? Promise.resolve({ role: 'admin', permissions: [] })
        : Promise.resolve(null),
    );
  });

  const authed = (r) => r.set('Authorization', 'Bearer tok');
  const body = {
    appointmentIds: ['a1', 'a2'],
    organizationId: 'org-a',
    groupByClient: true,
  };

  test('starts workflow and returns 202 with workflowId', async () => {
    mockStartWorkflow.mockResolvedValue({ workflowId: 'bulk-invoices-org-a-hash' });
    const res = await authed(
      request(app).post('/bulk/generate-invoices?async=true'),
    ).send(body);
    expect(res.status).toBe(202);
    expect(res.body.data.workflowId).toBe('bulk-invoices-org-a-hash');
    expect(res.body.data.status).toBe('started');
    expect(mockStartWorkflow).toHaveBeenCalledTimes(1);
    const [, opts] = mockStartWorkflow.mock.calls[0];
    expect(opts.workflowIdReusePolicy).toBe(
      'WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE',
    );
  });

  test('duplicate submit reports already-running instead of erroring', async () => {
    mockStartWorkflow.mockRejectedValue(new Error('WorkflowExecutionAlreadyStarted'));
    const res = await authed(
      request(app).post('/bulk/generate-invoices?async=true'),
    ).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('already-running');
  });

  test('sync path delegates to the service with identical summary', async () => {
    mockGenerate.mockResolvedValue({
      invoiceCount: 2,
      appointmentCount: 2,
      totalAmount: 440,
    });
    const res = await authed(request(app).post('/bulk/generate-invoices')).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { invoiceCount: 2, appointmentCount: 2, totalAmount: 440 },
    });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  test('rejects cross-org body with 400/403', async () => {
    const res = await authed(request(app).post('/bulk/generate-invoices')).send({
      ...body,
      organizationId: 'org-evil',
    });
    expect([400, 403]).toContain(res.status);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('bulk job polling', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'u', email: 'a@x.com' });
    mockUserFindOne.mockResolvedValue({
      _id: 'u1',
      email: 'a@x.com',
      roles: ['admin'],
      organizationId: 'org-a',
      lastActiveOrganizationId: 'org-a',
    });
    mockUserOrgFindOne.mockImplementation((query) =>
      query &&
      query.userId === 'u1' &&
      query.organizationId === 'org-a' &&
      query.isActive
        ? Promise.resolve({ role: 'admin', permissions: [] })
        : Promise.resolve(null),
    );
  });

  const authed = (r) =>
    r.set('Authorization', 'Bearer tok').query({ organizationId: 'org-a' });

  test('returns workflow status for own org job', async () => {
    mockDescribeWorkflow.mockResolvedValue({
      workflowId: 'bulk-invoices-org-a-0123456789abcdef',
      status: 'completed',
      result: { invoiceCount: 2 },
    });
    const res = await authed(
      request(app).get('/bulk/jobs/bulk-invoices-org-a-0123456789abcdef'),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  test('rejects polling another org job with 403', async () => {
    const res = await authed(
      request(app).get('/bulk/jobs/bulk-invoices-org-evil-0123456789abcdef'),
    );
    expect(res.status).toBe(403);
    expect(mockDescribeWorkflow).not.toHaveBeenCalled();
  });

  test('returns 404 for unknown workflow', async () => {
    mockDescribeWorkflow.mockRejectedValue(new Error('not found'));
    const res = await authed(
      request(app).get('/bulk/jobs/bulk-invoices-org-a-0123456789abcdef'),
    );
    expect(res.status).toBe(404);
  });
});
