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

jest.mock('../../models/Shift', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../../models/User', () => ({ findOne: jest.fn() }));
jest.mock('../../models/UserOrganization', () => ({ findOne: jest.fn() }));
jest.mock('../../models/ClientAssignment', () => ({ find: jest.fn() }));

const mongoose = require('mongoose');
const Shift = require('../../models/Shift');
const User = require('../../models/User');
const UserOrganization = require('../../models/UserOrganization');
const ClientAssignment = require('../../models/ClientAssignment');
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
