/**
 * Tests for appointmentService.setWorkedTime supporting SIL roster shifts.
 *
 * SIL shifts are not ClientAssignment rows. Before this, saving worked time
 * from the client-details screen failed with "Assigned client not found" for
 * every SIL shift, so those hours never reached payroll/NDIS claims.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));
jest.mock('../../models/Client', () => ({ findOne: jest.fn() }));

// The service constructs `new WorkedTime({...})` and awaits `.save()`.
jest.mock('../../models/WorkedTime', () => {
  const save = jest.fn();
  const WorkedTime = jest.fn(function (doc) {
    this.doc = doc;
    this.save = save;
  });
  WorkedTime.__save = save;
  WorkedTime.find = jest.fn();
  WorkedTime.findOne = jest.fn();
  return WorkedTime;
});

const mongoose = require('mongoose');
const ClientAssignment = require('../../models/ClientAssignment');
const Shift = require('../../models/Shift');
const Client = require('../../models/Client');
const WorkedTime = require('../../models/WorkedTime');
const AppointmentService = require('../../services/appointmentService');

const USER_EMAIL = 'employee.seed.1@mailinator.com';
const CLIENT_EMAIL = 'sil.ndia@mailinator.com';
const CLIENT_ID = new mongoose.Types.ObjectId('555500000000000000000001');
const ROC_ID = new mongoose.Types.ObjectId('555500000000000000000002');
const ORG_ID = '699980eb8fd21a3864b1aade';

const utc = (iso) => new Date(iso);

const dayShift = {
  _id: new mongoose.Types.ObjectId('55550000000000000000000a'),
  employeeEmail: USER_EMAIL,
  clientId: CLIENT_ID,
  silRosterOfCareId: ROC_ID,
  organizationId: ORG_ID,
  shiftType: 'day',
  status: 'pending',
  startTime: utc('2026-10-22T22:00:00.000Z'), // Sydney 2026-10-23 09:00
  endTime: utc('2026-10-23T00:00:00.000Z'), // Sydney 11:00
};

const nightShift = {
  _id: new mongoose.Types.ObjectId('55550000000000000000000b'),
  employeeEmail: USER_EMAIL,
  clientId: CLIENT_ID,
  silRosterOfCareId: ROC_ID,
  organizationId: ORG_ID,
  shiftType: 'active_night',
  status: 'pending',
  startTime: utc('2026-10-23T11:00:00.000Z'), // Sydney 22:00
  endTime: utc('2026-10-24T14:00:00.000Z'), // Sydney next day 01:00
};

const chain = (value) => ({
  sort: () => ({ limit: () => ({ lean: () => Promise.resolve(value) }) }),
  lean: () => Promise.resolve(value),
});

beforeEach(() => {
  jest.clearAllMocks();
  ClientAssignment.findOne.mockResolvedValue(null);
  Client.findOne.mockReturnValue({
    lean: () => Promise.resolve({
      _id: CLIENT_ID,
      clientFirstName: 'Nadia',
      clientLastName: 'NDIA',
      clientEmail: CLIENT_EMAIL,
    }),
  });
  Shift.find.mockReturnValue(chain([dayShift, nightShift]));
  WorkedTime.__save.mockResolvedValue({ _id: 'worked-time-1' });
  WorkedTime.findOne.mockResolvedValue(null);
});

describe('appointmentService.setWorkedTime — SIL shift fallback', () => {
  test('saves worked time linked to the SIL shift when no assignment exists', async () => {
    const result = await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '02:00:00',
      shiftIndex: 0,
    });

    expect(result.success).toBe(true);
    expect(WorkedTime.__save).toHaveBeenCalledTimes(1);

    const doc = WorkedTime.mock.calls[0][0];
    expect(doc.organizationId).toBe(ORG_ID);
    expect(String(doc.silShiftId)).toBe(String(dayShift._id));
    expect(doc.assignedClientId).toBeUndefined();
    expect(doc.shiftDate).toBe('2026-10-23');
    expect(doc.shiftStartTime).toBe('09:00');
    expect(doc.shiftEndTime).toBe('11:00');
    expect(doc.timeWorked).toBe('02:00:00');
    expect(doc.totalHours).toBeCloseTo(2);
    expect(doc.totalSeconds).toBe(7200);

    // The shift window is built in the organisation's zone (Sydney AEDT,
    // UTC+11 in October), not the server's local zone.
    expect(doc.startTime.toISOString()).toBe('2026-10-22T22:00:00.000Z');
    expect(doc.endTime.toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });

  test('replays the same clientRequestId without creating a duplicate', async () => {
    WorkedTime.findOne.mockResolvedValue({
      _id: 'existing-worked-time',
      timeWorked: '02:00:00',
    });

    const result = await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '02:00:00',
      shiftIndex: 0,
      clientRequestId: 'offline-request-1',
    });

    expect(result).toMatchObject({ success: true, idempotent: true });
    expect(WorkedTime.__save).not.toHaveBeenCalled();
  });

  test('stores the clientRequestId on a new row', async () => {
    await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '02:00:00',
      shiftIndex: 0,
      clientRequestId: 'offline-request-2',
    });

    const doc = WorkedTime.mock.calls[0][0];
    expect(doc.clientRequestId).toBe('offline-request-2');
  });

  test('matches the selected date/time insteads of trusting a stale index', async () => {
    // Caller says the night shift (index 1), but passes its date/time. The
    // live schedule order is used to confirm which shift the hours belong to.
    await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '03:00:00',
      shiftIndex: 1,
      shiftDate: '2026-10-23',
      shiftStartTime: '22:00',
      shiftEndTime: '01:00',
    });

    const doc = WorkedTime.mock.calls[0][0];
    expect(String(doc.silShiftId)).toBe(String(nightShift._id));
    expect(doc.shiftDate).toBe('2026-10-23');
    expect(doc.shiftStartTime).toBe('22:00');
    expect(doc.shiftIndex).toBe(1);
  });

  test('resolves a date/time match even when the caller index is wrong', async () => {
    await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '03:00:00',
      shiftIndex: 0,
      shiftDate: '2026-10-23',
      shiftStartTime: '22:00',
      shiftEndTime: '01:00',
    });

    const doc = WorkedTime.mock.calls[0][0];
    expect(String(doc.silShiftId)).toBe(String(nightShift._id));
    expect(doc.shiftIndex).toBe(1);

    // Overnight: end must roll to the next day (Sydney 22:00 -> 01:00 = 3h).
    expect(doc.startTime.toISOString()).toBe('2026-10-23T11:00:00.000Z');
    expect(doc.endTime.toISOString()).toBe('2026-10-23T14:00:00.000Z');
    expect(doc.endTime.getTime() - doc.startTime.getTime()).toBe(3 * 60 * 60 * 1000);
  });

  test('still prefers a real ClientAssignment when one exists', async () => {
    ClientAssignment.findOne.mockResolvedValue({
      _id: new mongoose.Types.ObjectId('5555000000000000000000aa'),
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      organizationId: ORG_ID,
      schedule: [{ date: '2026-11-02', startTime: '10:00', endTime: '12:00' }],
    });

    await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '02:00:00',
      shiftIndex: 0,
    });

    const doc = WorkedTime.mock.calls[0][0];
    expect(doc.assignedClientId).toBeDefined();
    expect(doc.silShiftId).toBeUndefined();
    expect(doc.shiftDate).toBe('2026-11-02');
    expect(Shift.find).not.toHaveBeenCalled();
  });

  test('throws when the worker has neither assignment nor SIL shifts', async () => {
    Shift.find.mockReturnValue(chain([]));

    await expect(
      AppointmentService.setWorkedTime({
        userEmail: USER_EMAIL,
        clientEmail: CLIENT_EMAIL,
        timeList: '02:00:00',
        shiftIndex: 0,
      }),
    ).rejects.toThrow('Assigned client not found');
  });

  test('rejects an index that does not resolve to a shift', async () => {
    await expect(
      AppointmentService.setWorkedTime({
        userEmail: USER_EMAIL,
        clientEmail: CLIENT_EMAIL,
        timeList: '02:00:00',
        shiftIndex: 9,
      }),
    ).rejects.toThrow('Selected shift index is invalid');
  });
});
