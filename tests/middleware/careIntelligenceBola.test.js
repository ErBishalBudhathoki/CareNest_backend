/**
 * BOLA (Broken Object-Level Authorization) adversarial tests.
 *
 * history: POST /api/care-intelligence/* accepted any authenticated
 * caller's clientId with no organization binding — any user could pull
 * AI care reports/risks/plans for any other org's clients.
 *
 * These tests prove the fix: auth + validated membership + per-resource
 * ownership (403 cross-org, 200 same-org).
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

// Client store: client-a belongs to org-a, client-b belongs to org-b.
const clientsById = {
  'client-a': { _id: 'client-a', organizationId: 'org-a' },
  'client-b': { _id: 'client-b', organizationId: 'org-b' },
};
jest.mock('../../models/Client', () => ({
  findById: jest.fn((id) => ({
    select: jest.fn().mockResolvedValue(clientsById[id] || null),
  })),
}));

// Stub AI controllers: record invocation, return canned success.
// Route wiring captures these exact references at setup time, so tests
// assert invoked vs not-invoked per endpoint.
jest.mock('../../controllers/careIntelligenceController', () => {
  const fns = {};
  const names = [
    'generateIntelligenceReport',
    'analyzeCarePatterns',
    'predictCareNeeds',
    'optimizeCareDelivery',
    'generatePersonalizedInsights',
    'predictAllRisks',
    'predictFallsRisk',
    'predictBehaviorEscalation',
    'predictHealthDeterioration',
    'predictMedicationRisk',
    'analyzeRiskTrends',
    'generateCarePlan',
    'generateSmartGoals',
    'recommendServices',
    'adaptCarePlan',
    'trackGoalProgress',
    'generateEvidenceBasedRecommendations',
    'reportIncident',
    'analyzeRootCause',
    'detectPatterns',
    'predictRecurrence',
    'generateCorrectiveActions',
    'checkInteractions',
    'trackCompliance',
    'generateMedicationAlerts',
    'optimizeMedicationSchedule',
    'monitorSideEffects',
  ];
  for (const name of names) {
    fns[name] = jest.fn((req, res) => res.status(200).json({ ok: true }));
  }
  // Publish for assertions (factory runs before tests execute).
  globalThis.__careIntelMocks = fns;
  return { ...fns, __esModule: true };
});

const mocked = () => globalThis.__careIntelMocks;

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

const makeApp = () => {
  const t = express();
  t.use(express.json());
  // Mount the router directly: apiSecurityGate/subscriptionGate are tested
  // elsewhere; here we prove THIS router's own auth + org + ownership chain.
  // eslint-disable-next-line global-require
  t.use('/care-intelligence', require('../../routes/careIntelligenceRoutes'));
  return t;
};

describe('care-intelligence BOLA protection', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    app = makeApp();

    mockVerifyIdToken.mockResolvedValue({
      uid: 'attacker-uid',
      email: 'attacker@example.com',
    });
    // Attacker is a member of org-a only, with no fallback org.
    mockUserFindOne.mockResolvedValue({
      _id: 'attacker-id',
      email: 'attacker@example.com',
      roles: ['member'],
      organizationId: undefined,
      lastActiveOrganizationId: undefined,
    });
    mockUserOrgFindOne.mockImplementation((query) => {
      if (
        query &&
        query.userId === 'attacker-id' &&
        query.organizationId === 'org-a' &&
        query.isActive
      ) {
        return Promise.resolve({ role: 'member', permissions: [] });
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Re-arm static mocks cleared above.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'attacker-uid',
      email: 'attacker@example.com',
    });
    mockUserFindOne.mockResolvedValue({
      _id: 'attacker-id',
      email: 'attacker@example.com',
      roles: ['member'],
      organizationId: undefined,
      lastActiveOrganizationId: undefined,
    });
  });

  test('rejects unauthenticated cross-org read with 401', async () => {
    const res = await request(app).post(
      '/care-intelligence/intelligence/report/client-b?organizationId=org-a',
    );
    expect(res.status).toBe(401);
    expect(mocked().generateIntelligenceReport).not.toHaveBeenCalled();
  });

  test('rejects same-org-context read of another org client with 403', async () => {
    const res = await request(app)
      .post('/care-intelligence/intelligence/report/client-b')
      .set('Authorization', 'Bearer attacker-token')
      .send({ organizationId: 'org-a' });
    expect(res.status).toBe(403);
    expect(mocked().generateIntelligenceReport).not.toHaveBeenCalled();
  });

  test('rejects cross-org GET insight with 403', async () => {
    const res = await request(app)
      .get('/care-intelligence/intelligence/insights/client-b')
      .set('Authorization', 'Bearer attacker-token')
      .query({ organizationId: 'org-a' });
    expect(res.status).toBe(403);
    expect(mocked().generatePersonalizedInsights).not.toHaveBeenCalled();
  });

  test('rejects org mismatch on org-scoped aggregate with 403', async () => {
    const res = await request(app)
      .post('/care-intelligence/incident/patterns/org-b')
      .set('Authorization', 'Bearer attacker-token')
      .send({ organizationId: 'org-a' });
    expect(res.status).toBe(403);
    expect(mocked().detectPatterns).not.toHaveBeenCalled();
  });

  test('allows same-org access with 200 and invokes controller', async () => {
    const res = await request(app)
      .post('/care-intelligence/risk/predict-all/client-a')
      .set('Authorization', 'Bearer attacker-token')
      .send({ organizationId: 'org-a' });
    expect(res.status).toBe(200);
    expect(mocked().predictAllRisks).toHaveBeenCalledTimes(1);
  });

  test('requires organization context when none is resolvable', async () => {
    const res = await request(app)
      .post('/care-intelligence/risk/predict-all/client-a')
      .set('Authorization', 'Bearer attacker-token')
      .send({});
    expect(res.status).toBe(400);
    expect(mocked().predictAllRisks).not.toHaveBeenCalled();
  });
});
