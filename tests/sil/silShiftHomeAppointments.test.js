/**
 * Tests for the SIL-shift augmentation of appointmentService.loadAppointments.
 *
 * The employee home dashboard reads loadAppointments (ClientAssignments), but
 * SIL roster shifts live in the Shift collection. Without the augmentation a
 * support worker whose only bookings are SIL shifts sees "No upcoming
 * appointments" on home. These tests pin the synthesised shapes the mobile
 * dashboard parses: date 'YYYY-MM-DD', times 'HH:mm' in Australia/Sydney.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({ aggregate: jest.fn() }));
jest.mock('../../models/WorkedTime', () => ({}));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));
jest.mock('../../models/Client', () => ({ find: jest.fn() }));

const mongoose = require('mongoose');
const Shift = require('../../models/Shift');
const Client = require('../../models/Client');
const AppointmentService = require('../../services/appointmentService');

const CLIENT_ID = new mongoose.Types.ObjectId('555500000000000000000001');
const ROC_ID = new mongoose.Types.ObjectId('555500000000000000000002');

const utc = (iso) => new Date(iso);

/** Simulated Friday day shift: Sydney 2026-10-23 09:00-11:00 (AEDT, UTC+11). */
const dayShift = {
  _id: new mongoose.Types.ObjectId('55550000000000000000000a'),
  employeeEmail: 'worker@care.com',
  clientId: CLIENT_ID,
  silRosterOfCareId: ROC_ID,
  shiftType: 'day',
  status: 'pending',
  organizationId: new mongoose.Types.ObjectId('555500000000000000000003'),
  startTime: utc('2026-10-22T22:00:00.000Z'),
  endTime: utc('2026-10-23T00:00:00.000Z'),
};

/** Simulated active night: Sydney 2026-10-23 22:00 -> 2026-10-24 01:00. */
const nightShift = {
  _id: new mongoose.Types.ObjectId('55550000000000000000000b'),
  employeeEmail: 'worker@care.com',
  clientId: CLIENT_ID,
  silRosterOfCareId: ROC_ID,
  shiftType: 'active_night',
  status: 'pending',
  organizationId: new mongoose.Types.ObjectId('555500000000000000000003'),
  startTime: utc('2026-10-23T11:00:00.000Z'),
  endTime: utc('2026-10-24T14:00:00.000Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  Client.find.mockReturnValue({
    select: () => ({
      lean: async () => [
        {
          _id: CLIENT_ID,
          clientFirstName: 'Ava',
          clientLastName: 'Client',
          clientEmail: 'ava.client@mailinator.com',
        },
      ],
    }),
  });
});

describe('buildSilShiftAppointments', () => {
  test('groups SIL shifts per client with Sydney-local schedule items', async () => {
    Shift.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [dayShift, nightShift],
        }),
      }),
    });

    const result = await AppointmentService.buildSilShiftAppointments(
      'worker@care.com'
    );

    expect(result).toHaveLength(1);
    const appt = result[0];
    expect(appt.clientEmail).toBe('ava.client@mailinator.com');
    expect(appt.clientDetails.clientFirstName).toBe('Ava');
    expect(appt.isSilRosterShift).toBe(true);
    expect(appt.schedule).toHaveLength(2);

    // Friday day shift lands on Sydney 2026-10-23 09:00-11:00.
    expect(appt.schedule[0].date).toBe('2026-10-23');
    expect(appt.schedule[0].startTime).toBe('09:00');
    expect(appt.schedule[0].endTime).toBe('11:00');
    expect(appt.schedule[0].shiftType).toBe('day');

    // Active night crosses midnight in Sydney: ends 01:00 the next day.
    expect(appt.schedule[1].date).toBe('2026-10-23');
    expect(appt.schedule[1].startTime).toBe('22:00');
    expect(appt.schedule[1].endTime).toBe('01:00');
  });

  test('queries only SIL shifts (silRosterOfCareId set) not yet ended, excluding cancelled', async () => {
    Shift.find.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    });

    await AppointmentService.buildSilShiftAppointments('worker@care.com');

    const filter = Shift.find.mock.calls[0][0];
    expect(filter.employeeEmail).toBe('worker@care.com');
    expect(filter.silRosterOfCareId).toEqual({ $ne: null });
    expect(filter.status).toEqual({ $ne: 'cancelled' });
    expect(filter.endTime).toHaveProperty('$gte');
  });

  test('returns [] when the employee has no SIL shifts', async () => {
    Shift.find.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    });

    const result = await AppointmentService.buildSilShiftAppointments(
      'nobody@care.com'
    );

    expect(result).toEqual([]);
    expect(Client.find).not.toHaveBeenCalled();
  });

  test('tolerates a missing client document', async () => {
    Shift.find.mockReturnValue({
      sort: () => ({
        limit: () => ({ lean: async () => [dayShift] }),
      }),
    });
    Client.find.mockReturnValue({
      select: () => ({ lean: async () => [] }),
    });

    const result = await AppointmentService.buildSilShiftAppointments(
      'worker@care.com'
    );

    expect(result).toHaveLength(1);
    expect(result[0].clientDetails).toBeNull();
    expect(result[0].clientEmail).toBe('');
  });
});
