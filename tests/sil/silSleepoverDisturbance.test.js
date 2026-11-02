// Milestone 3.3: SCHADS Clause 25.7 Sleepover Disturbance Tracking & Conversion Tests
// Verifies that:
// 1. Sleepover shifts with <= 60 minutes of disturbance remain sleepover.
// 2. Sleepover shifts with > 60 minutes of disturbance convert to active_night with convertedToActiveNight = true.
// 3. Disturbances array is properly stored with duration, reasons, and timestamps.

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));
jest.mock('../../models/Client', () => ({ findOne: jest.fn() }));

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

const USER_EMAIL = 'worker.sleepover@care.org';
const CLIENT_EMAIL = 'participant.sil@care.org';
const CLIENT_ID = new mongoose.Types.ObjectId('555500000000000000000001');
const ROC_ID = new mongoose.Types.ObjectId('555500000000000000000002');
const ORG_ID = '699980eb8fd21a3864b1aade';

const sleepoverShift = {
  _id: new mongoose.Types.ObjectId('55550000000000000000000c'),
  employeeEmail: USER_EMAIL,
  clientId: CLIENT_ID,
  silRosterOfCareId: ROC_ID,
  organizationId: ORG_ID,
  shiftType: 'sleepover',
  status: 'pending',
  startTime: new Date('2026-10-23T12:00:00.000Z'), // Sydney 22:00
  endTime: new Date('2026-10-24T20:00:00.000Z'), // Sydney 06:00
};

const chain = (value) => ({
  sort: () => ({ limit: () => ({ lean: () => Promise.resolve(value) }) }),
  lean: () => Promise.resolve(value),
});

describe('Milestone 3.3 - Sleepover Disturbance Tracking & Conversion (SCHADS Clause 25.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ClientAssignment.findOne.mockResolvedValue(null);
    Client.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          _id: CLIENT_ID,
          clientFirstName: 'Robert',
          clientLastName: 'Sleepover',
          clientEmail: CLIENT_EMAIL,
        }),
    });
    Shift.find.mockReturnValue(chain([sleepoverShift]));
    WorkedTime.__save.mockResolvedValue({ _id: 'wt-sleepover-1' });
    WorkedTime.findOne.mockResolvedValue(null);
  });

  test('keeps sleepover shift type when total disturbance <= 60 minutes', async () => {
    const result = await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '08:00:00',
      shiftIndex: 0,
      shiftType: 'sleepover',
      disturbances: [
        {
          startTime: '2026-10-24T01:00:00.000Z',
          endTime: '2026-10-24T01:30:00.000Z',
          durationMinutes: 30,
          reason: 'Administered required nocturnal medication',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data.shiftType).toBe('sleepover');
    expect(result.data.convertedToActiveNight).toBe(false);
    expect(result.data.totalDisturbanceMinutes).toBe(30);

    const savedDoc = WorkedTime.mock.calls[0][0];
    expect(savedDoc.shiftType).toBe('sleepover');
    expect(savedDoc.convertedToActiveNight).toBe(false);
    expect(savedDoc.disturbances).toHaveLength(1);
    expect(savedDoc.disturbances[0].reason).toBe('Administered required nocturnal medication');
  });

  test('converts sleepover to active_night when disturbances exceed 60 minutes', async () => {
    const result = await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '08:00:00',
      shiftIndex: 0,
      shiftType: 'sleepover',
      disturbances: [
        {
          startTime: '2026-10-24T00:00:00.000Z',
          endTime: '2026-10-24T00:45:00.000Z',
          durationMinutes: 45,
          reason: 'Participant agitated, de-escalation required',
        },
        {
          startTime: '2026-10-24T02:00:00.000Z',
          endTime: '2026-10-24T02:30:00.000Z',
          durationMinutes: 30,
          reason: 'Assisted with bathroom and repositioning',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data.shiftType).toBe('active_night');
    expect(result.data.convertedToActiveNight).toBe(true);
    expect(result.data.totalDisturbanceMinutes).toBe(75);

    const savedDoc = WorkedTime.mock.calls[0][0];
    expect(savedDoc.shiftType).toBe('active_night');
    expect(savedDoc.convertedToActiveNight).toBe(true);
    expect(savedDoc.disturbances).toHaveLength(2);
  });

  test('honors explicit convertedToActiveNight flag even if disturbances array is omitted', async () => {
    const result = await AppointmentService.setWorkedTime({
      userEmail: USER_EMAIL,
      clientEmail: CLIENT_EMAIL,
      timeList: '08:00:00',
      shiftIndex: 0,
      shiftType: 'sleepover',
      convertedToActiveNight: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.shiftType).toBe('active_night');
    expect(result.data.convertedToActiveNight).toBe(true);
  });
});
