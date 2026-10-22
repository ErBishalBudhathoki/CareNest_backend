/**
 * Tests for appointmentService.loadAppointmentDetails falling back to SIL
 * roster shifts.
 *
 * SIL shifts live in the Shift collection and are not ClientAssignment rows.
 * Tapping a SIL shift card on the employee home used to open the details
 * screen with no data (endless loading). The service now builds the same
 * appointment shape from the worker's SIL shifts for that participant.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({ aggregate: jest.fn() }));
jest.mock('../../models/WorkedTime', () => ({ find: jest.fn() }));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));
jest.mock('../../models/Client', () => ({ findOne: jest.fn() }));

const mongoose = require('mongoose');
const ClientAssignment = require('../../models/ClientAssignment');
const WorkedTime = require('../../models/WorkedTime');
const Shift = require('../../models/Shift');
const Client = require('../../models/Client');
const AppointmentService = require('../../services/appointmentService');

const USER_EMAIL = 'employee.seed.1@mailinator.com';
const CLIENT_EMAIL = 'sil.ndia@mailinator.com';
const CLIENT_ID = new mongoose.Types.ObjectId('555500000000000000000001');
const ROC_ID = new mongoose.Types.ObjectId('555500000000000000000002');
const ORG_ID = new mongoose.Types.ObjectId('555500000000000000000003');

const clientDoc = {
  _id: CLIENT_ID,
  clientFirstName: 'Nadia',
  clientLastName: 'NDIA',
  clientEmail: CLIENT_EMAIL,
  clientPhoneNumber: '0400000000',
};

const utc = (iso) => new Date(iso);

// Sydney 2026-10-23 09:00-11:00 (AEDT, UTC+11).
const dayShift = {
  _id: new mongoose.Types.ObjectId('55550000000000000000000a'),
  employeeEmail: USER_EMAIL,
  clientId: CLIENT_ID,
  silRosterOfCareId: ROC_ID,
  organizationId: ORG_ID,
  shiftType: 'day',
  status: 'pending',
  startTime: utc('2026-10-22T22:00:00.000Z'),
  endTime: utc('2026-10-23T00:00:00.000Z'),
};

const chain = (value) => ({
  sort: () => ({ limit: () => ({ lean: () => Promise.resolve(value) }) }),
  lean: () => Promise.resolve(value),
});

beforeEach(() => {
  jest.clearAllMocks();
  ClientAssignment.aggregate.mockResolvedValue([]);
  WorkedTime.find.mockReturnValue(chain([]));
  Client.findOne.mockReturnValue({ lean: () => Promise.resolve(clientDoc) });
  Shift.find.mockReturnValue(chain([dayShift]));
});

describe('appointmentService.loadAppointmentDetails — SIL fallback', () => {
  test('builds details from SIL shifts when no ClientAssignment exists', async () => {
    const result = await AppointmentService.loadAppointmentDetails(
      USER_EMAIL,
      CLIENT_EMAIL,
    );

    expect(result.assignedClient).toBeDefined();
    expect(result.assignedClient.isSilRosterShift).toBe(true);
    expect(result.assignedClient.userEmail).toBe(USER_EMAIL);
    expect(result.assignedClient.clientEmail).toBe(CLIENT_EMAIL);
    expect(result.assignedClient._id).toBe(`sil-shift-${String(dayShift._id)}`);

    // Participant details drive the client information card.
    expect(result.clientDetails).toHaveLength(1);
    expect(result.clientDetails[0]).toMatchObject({
      clientFirstName: 'Nadia',
      clientLastName: 'NDIA',
      clientEmail: CLIENT_EMAIL,
    });

    // Schedule renders in the worker's local zone (Australia/Sydney).
    expect(result.assignedClient.schedule).toHaveLength(1);
    expect(result.assignedClient.schedule[0]).toMatchObject({
      shiftId: String(dayShift._id),
      date: '2026-10-23',
      startTime: '09:00',
      endTime: '11:00',
    });

    // Legacy arrays kept for the older table renderer.
    expect(result.assignedClient.dateList).toEqual(['2026-10-23']);
    expect(result.assignedClient.startTimeList).toEqual(['09:00']);
    expect(result.assignedClient.endTimeList).toEqual(['11:00']);
  });

  test('includes worked-time history for the participant', async () => {
    WorkedTime.find.mockReturnValue(
      chain([
        {
          _id: new mongoose.Types.ObjectId('55550000000000000000000f'),
          shiftDate: '2026-10-22',
          shiftStartTime: '09:00',
          shiftEndTime: '11:00',
        },
      ]),
    );

    const result = await AppointmentService.loadAppointmentDetails(
      USER_EMAIL,
      CLIENT_EMAIL,
    );

    expect(result.assignedClient.timeRecords).toHaveLength(1);
    expect(result.assignedClient.timeRecords[0]).toMatchObject({
      date: '2026-10-22',
      startTime: '09:00',
      endTime: '11:00',
    });
  });

  test('prefers a real ClientAssignment when one exists', async () => {
    ClientAssignment.aggregate.mockResolvedValue([
      {
        _id: new mongoose.Types.ObjectId('5555000000000000000000aa'),
        userEmail: USER_EMAIL,
        clientEmail: CLIENT_EMAIL,
        schedule: [{ date: '2026-11-02', startTime: '10:00', endTime: '12:00' }],
        clientDetails: clientDoc,
      },
    ]);

    const result = await AppointmentService.loadAppointmentDetails(
      USER_EMAIL,
      CLIENT_EMAIL,
    );

    expect(result.assignedClient.isSilRosterShift).toBeUndefined();
    expect(Shift.find).not.toHaveBeenCalled();
  });

  test('skips shifts the worker is not rostered on', async () => {
    Shift.find.mockReturnValue(chain([]));

    await expect(
      AppointmentService.loadAppointmentDetails(USER_EMAIL, CLIENT_EMAIL),
    ).rejects.toThrow('No appointment found for this user-client combination');
  });

  test('throws when the participant does not exist', async () => {
    Client.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    await expect(
      AppointmentService.loadAppointmentDetails(USER_EMAIL, CLIENT_EMAIL),
    ).rejects.toThrow('No appointment found for this user-client combination');
  });
});
