/**
 * BOLA follow-up: appointment email binding, org-assignment scoping,
 * conversation-list scoping.
 *
 * history: loadAppointments/:email served ANY email to ANY authenticated
 * user; getOrganizationAssignments/:organizationId had no membership
 * check; getConversations UNIONED the requested userId into the query,
 * leaking other users' thread lists.
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

const mockSvcLoadAppointments = jest.fn();
const mockSvcLoadDetails = jest.fn();
const mockSvcOrgAssignments = jest.fn();
jest.mock('../../services/appointmentService', () => ({
  loadAppointments: (...args) => mockSvcLoadAppointments(...args),
  loadAppointmentDetails: (...args) => mockSvcLoadDetails(...args),
  getOrganizationAssignments: (...args) =>
    mockSvcOrgAssignments(...args),
}));

const mockHubFind = jest.fn();
jest.mock('../../models/HubConversation', () => ({
  find: (...args) => mockHubFind(...args),
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
}));

const AppointmentController =
  require('../../controllers/appointmentController');
const hubService = require('../../services/communicationHubService');

const ORG_A = '699980eb8fd21a3864b1aade';
const ORG_B = '799980eb8fd21a3864b1aabf';

function mockRes() {
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

const memberUser = {
  _id: 'member-id',
  email: 'member@example.com',
  roles: ['member'],
  organizationId: undefined,
  lastActiveOrganizationId: undefined,
};

const adminUser = {
  _id: 'admin-id',
  email: 'admin@example.com',
  roles: ['admin'],
  organizationId: undefined,
  lastActiveOrganizationId: undefined,
};

function armAuth(user) {
  mockVerifyIdToken.mockResolvedValue({ uid: 'x', email: user.email });
  mockUserFindOne.mockResolvedValue(user);
  mockUserOrgFindOne.mockImplementation((q) =>
    q && q.userId === user._id && q.organizationId === ORG_A && q.isActive
      ? Promise.resolve({ role: 'member', permissions: [] })
      : Promise.resolve(null),
  );
}

describe('appointment email binding (IDOR)', () => {
  // catchAsync handlers are fire-and-forget, so direct unit invocations
  // must flush the event loop before asserting on async completion.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeEach(() => {
    jest.clearAllMocks();
    armAuth(memberUser);
    mockSvcLoadAppointments.mockResolvedValue([]);
    mockSvcLoadDetails.mockResolvedValue({});
  });

  test('serves own email', async () => {
    const res = mockRes();
    await AppointmentController.loadAppointments(
      { params: { email: 'member@example.com' }, user: memberUser, ip: '1.1.1.1' },
      res,
    );
    await flush();
    expect(res.statusCode).toBe(200);
    expect(mockSvcLoadAppointments).toHaveBeenCalledWith(
      'member@example.com',
    );
  });

  test('rejects another user email with 403', async () => {
    const res = mockRes();
    await AppointmentController.loadAppointments(
      { params: { email: 'victim@example.com' }, user: memberUser, ip: '1.1.1.1' },
      res,
    );
    await flush();
    expect(res.statusCode).toBe(403);
    expect(mockSvcLoadAppointments).not.toHaveBeenCalled();
  });

  test('rejects cross-user appointment details with 403', async () => {
    const res = mockRes();
    await AppointmentController.loadAppointmentDetails(
      {
        params: { userEmail: 'victim@example.com', clientEmail: 'c@example.com' },
        user: memberUser,
        ip: '1.1.1.1',
      },
      res,
    );
    await flush();
    expect(res.statusCode).toBe(403);
    expect(mockSvcLoadDetails).not.toHaveBeenCalled();
  });

  test('allows admin to view another user email', async () => {
    const res = mockRes();
    await AppointmentController.loadAppointments(
      { params: { email: 'victim@example.com' }, user: adminUser, ip: '1.1.1.1' },
      res,
    );
    await flush();
    expect(res.statusCode).toBe(200);
    expect(mockSvcLoadAppointments).toHaveBeenCalled();
  });
});

describe('organization assignments scoping', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    const t = express();
    t.use(express.json());
    // eslint-disable-next-line global-require
    t.use('/appointments', require('../../routes/appointment'));
    app = t;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    armAuth(memberUser);
    mockSvcOrgAssignments.mockResolvedValue([]);
  });

  test('rejects unauthenticated org assignment listing with 401', async () => {
    const res = await request(app).get(
      `/appointments/getOrganizationAssignments/${ORG_A}`,
    );
    expect(res.status).toBe(401);
  });

  test('serves member org assignments with 200', async () => {
    const res = await request(app)
      .get(`/appointments/getOrganizationAssignments/${ORG_A}`)
      .set('Authorization', 'Bearer member-token');
    expect(res.status).toBe(200);
    expect(mockSvcOrgAssignments).toHaveBeenCalledWith(ORG_A);
  });

  test('rejects non-member org assignments with 400/403', async () => {
    const res = await request(app)
      .get(`/appointments/getOrganizationAssignments/${ORG_B}`)
      .set('Authorization', 'Bearer member-token');
    expect([400, 403]).toContain(res.status);
    expect(mockSvcOrgAssignments).not.toHaveBeenCalled();
  });
});

describe('conversation list scoping (IDOR)', () => {
  const convFor = (owner, other) => ({
    _id: { toString: () => 'conv-1' },
    participants: [owner, other],
    participantNames: { [other]: 'Other Person' },
    unreadCount: {},
    isActive: true,
    lastMessage: 'hi',
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    type: 'direct',
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns own conversations only, ignoring foreign userId param', async () => {
    const mine = convFor('member@example.com', 'friend@example.com');
    mockHubFind.mockReturnValue({
      sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([mine]) })),
    });
    const result = await hubService.getConversations('member@example.com', {
      email: 'member@example.com',
      userId: 'member-id',
      roles: ['member'],
    });
    expect(result.success).toBe(true);
    // Query must be built from caller identity, never the param.
    const query = mockHubFind.mock.calls[0][0];
    expect(JSON.stringify(query)).not.toContain('victim@example.com');
    expect(JSON.stringify(query)).toContain('member@example.com');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].participantName).toBe('Other Person');
  });

  test('returns empty list for foreign userId without admin role', async () => {
    const victimConv = convFor('victim@example.com', 'friend@example.com');
    mockHubFind.mockReturnValue({
      sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([victimConv]) })),
    });
    // Even if the query layer returned victim rows, the guard short-circuits.
    const result = await hubService.getConversations('victim@example.com', {
      email: 'member@example.com',
      userId: 'member-id',
      roles: ['member'],
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(mockHubFind).not.toHaveBeenCalled();
  });
});
