/**
 * Tests for Phase 5 multi-stakeholder CRM. Models are mocked.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/Stakeholder', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../models/Client', () => ({
  findOne: jest.fn(),
}));

const Stakeholder = require('../../models/Stakeholder');
const Client = require('../../models/Client');
const stakeholderService = require('../../services/stakeholderService');
const stakeholderController = require('../../controllers/stakeholderController');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((p) => {
    res.body = p;
    return res;
  });
  return res;
}

describe('StakeholderService.createStakeholder', () => {
  test('creates an org-scoped stakeholder', async () => {
    Stakeholder.create.mockImplementation(async (doc) => ({ _id: 's1', ...doc }));

    const stakeholder = await stakeholderService.createStakeholder(
      'org1',
      { name: 'PM Co', type: 'plan_manager', email: 'pm@x.com' },
      'admin@org.com',
    );

    expect(stakeholder.organizationId).toBe('org1');
    expect(stakeholder.type).toBe('plan_manager');
    expect(stakeholder.createdBy).toBe('admin@org.com');
  });
});

describe('StakeholderService.linkToClient', () => {
  test('links a stakeholder and sets funding type', async () => {
    Stakeholder.findOne.mockResolvedValue({ _id: 's1', type: 'plan_manager' });
    const save = jest.fn();
    Client.findOne.mockResolvedValue({ _id: 'c1', stakeholders: [], save });

    const client = await stakeholderService.linkToClient('org1', 'c1', {
      stakeholderId: 's1',
      isPrimary: true,
      fundingType: 'plan_managed',
    });

    expect(client.stakeholders).toHaveLength(1);
    expect(client.stakeholders[0].isPrimary).toBe(true);
    expect(client.fundingType).toBe('plan_managed');
    expect(save).toHaveBeenCalled();
  });

  test('is idempotent when the same stakeholder is linked twice', async () => {
    Stakeholder.findOne.mockResolvedValue({ _id: 's1', type: 'support_coordinator' });
    const save = jest.fn();
    Client.findOne.mockResolvedValue({
      _id: 'c1',
      stakeholders: [{ stakeholderId: { toString: () => 's1' }, role: 'support_coordinator' }],
      save,
    });

    const client = await stakeholderService.linkToClient('org1', 'c1', {
      stakeholderId: 's1',
    });

    expect(client.stakeholders).toHaveLength(1);
  });

  test('throws 404 when the stakeholder does not exist', async () => {
    Stakeholder.findOne.mockResolvedValue(null);
    Client.findOne.mockResolvedValue({ _id: 'c1', stakeholders: [], save: jest.fn() });

    await expect(
      stakeholderService.linkToClient('org1', 'c1', { stakeholderId: 'missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 404 when the client does not exist', async () => {
    Stakeholder.findOne.mockResolvedValue({ _id: 's1' });
    Client.findOne.mockResolvedValue(null);

    await expect(
      stakeholderService.linkToClient('org1', 'missing', { stakeholderId: 's1' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('StakeholderService.unlinkFromClient', () => {
  test('removes the link', async () => {
    const save = jest.fn();
    Client.findOne.mockResolvedValue({
      _id: 'c1',
      stakeholders: [
        { stakeholderId: { toString: () => 's1' } },
        { stakeholderId: { toString: () => 's2' } },
      ],
      save,
    });

    const client = await stakeholderService.unlinkFromClient('org1', 'c1', 's1');

    expect(client.stakeholders).toHaveLength(1);
    expect(client.stakeholders[0].stakeholderId.toString()).toBe('s2');
    expect(save).toHaveBeenCalled();
  });
});

describe('StakeholderService.getClientCareTeam', () => {
  test('returns the care team with populated stakeholder details', async () => {
    Client.findOne.mockResolvedValue({
      _id: 'c1',
      fundingType: 'plan_managed',
      stakeholders: [
        { stakeholderId: { toString: () => 's1' }, role: 'plan_manager', isPrimary: true },
      ],
    });
    Stakeholder.find.mockResolvedValue([
      { _id: { toString: () => 's1' }, name: 'PM Co', type: 'plan_manager' },
    ]);

    const careTeam = await stakeholderService.getClientCareTeam('org1', 'c1');

    expect(careTeam.fundingType).toBe('plan_managed');
    expect(careTeam.careTeam).toHaveLength(1);
    expect(careTeam.careTeam[0].stakeholder.name).toBe('PM Co');
    expect(careTeam.careTeam[0].isPrimary).toBe(true);
  });

  test('returns null when the client does not exist', async () => {
    Client.findOne.mockResolvedValue(null);
    expect(await stakeholderService.getClientCareTeam('org1', 'x')).toBeNull();
  });
});

describe('StakeholderController org scoping', () => {
  test('listStakeholders returns 400 without an organization', async () => {
    const req = { user: {}, query: {} };
    const res = mockRes();
    await stakeholderController.listStakeholders(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('MISSING_ORGANIZATION');
  });
});
