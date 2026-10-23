/**
 * Tenant-isolation tests for shift assignment (the SIL roster "Assign" path).
 *
 * `PUT /schedule/shift/:id` used to update any shift by id, accept any user
 * email as the assignee, and pass the raw body into `$set`. An admin of one
 * organisation could therefore edit another tenant's shift, point it at a
 * worker outside the tenant, or rewrite `organizationId`. These tests pin the
 * scoping introduced with the SIL Tier-1 hardening.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/Shift', () => {
  const save = jest.fn();
  const Shift = jest.fn(function (doc) {
    this._doc = doc;
    this._id = { toString: () => 'new-shift-id' };
    this.save = save;
    this.toObject = () => ({ ...doc });
  });
  Shift.__save = save;
  Shift.findOne = jest.fn();
  Shift.findOneAndUpdate = jest.fn();
  Shift.find = jest.fn();
  return Shift;
});
jest.mock('../../models/User', () => ({ findOne: jest.fn() }));
jest.mock('../../models/UserOrganization', () => ({ findOne: jest.fn() }));
jest.mock('../../models/ClientAssignment', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../../models/Client', () => ({ findOne: jest.fn() }));

const mongoose = require('mongoose');
const Shift = require('../../models/Shift');
const User = require('../../models/User');
const UserOrganization = require('../../models/UserOrganization');
const ClientAssignment = require('../../models/ClientAssignment');
const Client = require('../../models/Client');
const SchedulerService = require('../../services/schedulerService');

const ORG = '699980eb8fd21a3864b1aade';
const OTHER_ORG = '699980eb8fd21a3864b1aa99';
const SHIFT_ID = '55550000000000000000000a';
const EMPLOYEE_ID = new mongoose.Types.ObjectId('5555000000000000000000e1');

const shift = {
  _id: SHIFT_ID,
  organizationId: ORG,
  employeeEmail: null,
  employeeId: null,
  startTime: new Date('2026-10-22T22:00:00.000Z'),
  endTime: new Date('2026-10-23T00:00:00.000Z'),
  status: 'pending',
};

const selectChain = (value) => ({ select: () => ({ lean: async () => value }) });
const leanChain = (value) => ({ lean: async () => value });

beforeEach(() => {
  jest.clearAllMocks();
  Shift.findOne.mockResolvedValue(shift);
  Shift.find.mockResolvedValue([]);
  Shift.findOneAndUpdate.mockResolvedValue({ ...shift, status: 'approved' });
  ClientAssignment.find.mockResolvedValue([]);
  User.findOne.mockReturnValue(selectChain({ _id: EMPLOYEE_ID, email: 'worker@org.com' }));
  UserOrganization.findOne.mockReturnValue(leanChain({ userId: EMPLOYEE_ID, role: 'employee' }));
  Client.findOne.mockReturnValue({
    select: () => ({ lean: async () => ({ _id: 'client-1', clientEmail: 'client@org.com' }) }),
  });
  ClientAssignment.findOne.mockReturnValue(leanChain(null));
  Shift.__save.mockResolvedValue({
    _id: { toString: () => 'new-shift-id' },
    toObject: () => ({ _id: 'new-shift-id' }),
  });
});

describe('schedulerService.updateShift — tenant isolation', () => {
  test('writes are scoped to the caller organisation', async () => {
    const result = await SchedulerService.updateShift(
      SHIFT_ID,
      { status: 'approved' },
      ORG,
    );

    expect(result.success).toBe(true);
    expect(Shift.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: SHIFT_ID, organizationId: ORG },
      expect.any(Object),
      { new: true },
    );
  });

  test('scopes the conflict lookup to the caller organisation', async () => {
    await SchedulerService.updateShift(
      SHIFT_ID,
      { employeeEmail: 'worker@org.com' },
      ORG,
    );

    expect(Shift.findOne).toHaveBeenCalledWith({
      _id: SHIFT_ID,
      organizationId: ORG,
    });
  });

  test('cannot update a shift owned by another organisation', async () => {
    Shift.findOne.mockResolvedValue(null);
    Shift.findOneAndUpdate.mockResolvedValue(null);

    const result = await SchedulerService.updateShift(
      SHIFT_ID,
      { status: 'approved' },
      OTHER_ORG,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe(404);
    expect(Shift.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: SHIFT_ID, organizationId: OTHER_ORG },
      expect.any(Object),
      { new: true },
    );
  });

  test('rejects an assignee who is not a member of the organisation', async () => {
    UserOrganization.findOne.mockReturnValue(leanChain(null));
    User.findOne.mockReturnValue(
      selectChain({ _id: EMPLOYEE_ID, email: 'outside@other.com', organizationId: OTHER_ORG }),
    );

    const result = await SchedulerService.updateShift(
      SHIFT_ID,
      { employeeEmail: 'outside@other.com' },
      ORG,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe(403);
    expect(Shift.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('ignores attempts to rewrite tenancy or roster linkage fields', async () => {
    await SchedulerService.updateShift(
      SHIFT_ID,
      {
        status: 'approved',
        organizationId: OTHER_ORG,
        silRosterOfCareId: '555500000000000000000009',
        createdBy: 'attacker',
      },
      ORG,
    );

    const update = Shift.findOneAndUpdate.mock.calls[0][1].$set;
    expect(update.organizationId).toBeUndefined();
    expect(update.silRosterOfCareId).toBeUndefined();
    expect(update.createdBy).toBeUndefined();
    expect(update.status).toBe('approved');
  });

  test('resolves a valid in-org assignee and stores their user id', async () => {
    const result = await SchedulerService.updateShift(
      SHIFT_ID,
      { employeeEmail: 'Worker@Org.com' },
      ORG,
    );

    expect(result.success).toBe(true);
    expect(UserOrganization.findOne).toHaveBeenCalledWith({
      userId: EMPLOYEE_ID,
      organizationId: ORG,
      isActive: true,
    });
    const update = Shift.findOneAndUpdate.mock.calls[0][1].$set;
    expect(update.employeeEmail).toBe('worker@org.com');
    expect(String(update.employeeId)).toBe(String(EMPLOYEE_ID));
  });

  test('conflict detection only looks at shifts in the same organisation', async () => {
    await SchedulerService.updateShift(
      SHIFT_ID,
      { employeeEmail: 'worker@org.com' },
      ORG,
    );

    expect(Shift.find).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG }),
    );
    expect(ClientAssignment.find).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG }),
    );
  });
});

describe('schedulerService.deleteShift — tenant isolation', () => {
  test('cancels only a shift in the caller organisation', async () => {
    const result = await SchedulerService.deleteShift(SHIFT_ID, ORG);

    expect(result.success).toBe(true);
    expect(Shift.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: SHIFT_ID, organizationId: ORG },
      expect.any(Object),
      { new: true },
    );
  });

  test('returns 404 for a shift in another organisation', async () => {
    Shift.findOneAndUpdate.mockResolvedValue(null);

    const result = await SchedulerService.deleteShift(SHIFT_ID, OTHER_ORG);

    expect(result.success).toBe(false);
    expect(result.code).toBe(404);
  });
});

describe('schedulerService.createShift — tenant isolation', () => {
  const baseShift = {
    startTime: new Date('2026-10-26T22:00:00.000Z'),
    endTime: new Date('2026-10-27T00:00:00.000Z'),
    status: 'pending',
  };

  test('forces the caller organisation and ignores body organizationId', async () => {
    const result = await SchedulerService.createShift(
      { ...baseShift, organizationId: OTHER_ORG },
      ORG,
    );

    expect(result.success).toBe(true);
    const stored = Shift.mock.calls[0][0];
    expect(stored.organizationId).toBe(ORG);
    expect(stored.createdBy).toBeUndefined();
    expect(stored.silRosterOfCareId).toBeUndefined();
  });

  test('rejects an assignee who is not an org member', async () => {
    UserOrganization.findOne.mockReturnValue(leanChain(null));
    User.findOne.mockReturnValue(
      selectChain({ _id: EMPLOYEE_ID, email: 'outside@other.com', organizationId: OTHER_ORG }),
    );

    const result = await SchedulerService.createShift(
      { ...baseShift, employeeEmail: 'outside@other.com' },
      ORG,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe(403);
    expect(Shift.__save).not.toHaveBeenCalled();
  });

  test('rejects a client from another organisation', async () => {
    Client.findOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });

    const result = await SchedulerService.createShift(
      { ...baseShift, clientId: '555500000000000000000009' },
      ORG,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe(403);
    expect(Shift.__save).not.toHaveBeenCalled();
  });

  test('assigns the resolved employee id and client email for a valid create', async () => {
    const result = await SchedulerService.createShift(
      {
        ...baseShift,
        employeeEmail: 'Worker@Org.com',
        clientId: '555500000000000000000001',
      },
      ORG,
    );

    expect(result.success).toBe(true);
    const stored = Shift.mock.calls[0][0];
    expect(stored.employeeEmail).toBe('worker@org.com');
    expect(String(stored.employeeId)).toBe(String(EMPLOYEE_ID));
    expect(stored.clientEmail).toBe('client@org.com');
    expect(stored.organizationId).toBe(ORG);
  });
});

describe('schedulerService.bulkCreateShifts — tenant isolation', () => {
  test('applies the caller organisation to every shift in the batch', async () => {
    await SchedulerService.bulkCreateShifts(
      [
        { startTime: new Date('2026-10-26T22:00:00.000Z'), endTime: new Date('2026-10-27T00:00:00.000Z') },
        { startTime: new Date('2026-10-27T22:00:00.000Z'), endTime: new Date('2026-10-28T00:00:00.000Z') },
      ],
      ORG,
    );

    expect(Shift).toHaveBeenCalledTimes(2);
    for (const call of Shift.mock.calls) {
      expect(call[0].organizationId).toBe(ORG);
    }
  });
});

describe('schedulerService shift writes — client email validation', () => {
  const baseShift = {
    startTime: new Date('2026-10-28T22:00:00.000Z'),
    endTime: new Date('2026-10-29T00:00:00.000Z'),
  };

  test('createShift rejects a clientEmail from another organisation', async () => {
    Client.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

    const result = await SchedulerService.createShift(
      { ...baseShift, clientEmail: 'outside@other.com' },
      ORG,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe(403);
    expect(Shift.__save).not.toHaveBeenCalled();
  });

  test('createShift resolves clientId from a valid clientEmail', async () => {
    const result = await SchedulerService.createShift(
      { ...baseShift, clientEmail: 'Client@Org.com' },
      ORG,
    );

    expect(result.success).toBe(true);
    const stored = Shift.mock.calls[0][0];
    expect(String(stored.clientId)).toBe('client-1');
    expect(stored.clientEmail).toBe('client@org.com');
  });

  test('updateShift rejects a clientEmail from another organisation', async () => {
    Client.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

    const result = await SchedulerService.updateShift(
      SHIFT_ID,
      { clientEmail: 'outside@other.com' },
      ORG,
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe(403);
    expect(Shift.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
