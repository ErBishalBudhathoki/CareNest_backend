/**
 * Overnight overlap tests for schedulerService.checkAssignmentConflicts.
 *
 * The old implementation compared minute-of-day values, so a proposal that
 * crossed midnight (22:00 -> 01:00) produced end < start and either missed
 * real conflicts or invented false ones.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({ find: jest.fn() }));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));

const dateHelpers = require('../../utils/dateHelpers');
const ClientAssignment = require('../../models/ClientAssignment');
const SchedulerService = require('../../services/schedulerService');

const ORG = '699980eb8fd21a3864b1aade';
const TZ = 'Australia/Sydney';

const sydney = (y, m, d, h, min) =>
  dateHelpers.zonedWallClockToUtc(y, m, d, h, min, TZ);

const assignmentWith = (slot) => ({
  _id: { toString: () => 'assignment-1' },
  clientEmail: 'client@org.com',
  schedule: [slot],
});

beforeEach(() => {
  jest.clearAllMocks();
  ClientAssignment.find.mockResolvedValue([
    assignmentWith({
      date: '2026-10-23',
      startTime: '22:00',
      endTime: '02:00', // overnight slot
    }),
  ]);
});

describe('checkAssignmentConflicts — overnight windows', () => {
  test('detects a proposal overlapping the tail of an overnight slot', async () => {
    const result = await SchedulerService.checkAssignmentConflicts(
      'worker@org.com',
      sydney(2026, 10, 24, 1, 0),
      sydney(2026, 10, 24, 3, 0),
      ORG,
    );

    expect(result.hasConflict).toBe(true);
    expect(result.conflicts[0]).toMatchObject({
      type: 'assignment',
      clientEmail: 'client@org.com',
    });
  });

  test('detects an overnight proposal overlapping the slot', async () => {
    const result = await SchedulerService.checkAssignmentConflicts(
      'worker@org.com',
      sydney(2026, 10, 23, 23, 0),
      sydney(2026, 10, 24, 1, 0),
      ORG,
    );

    expect(result.hasConflict).toBe(true);
  });

  test('allows a proposal after the overnight slot finishes', async () => {
    const result = await SchedulerService.checkAssignmentConflicts(
      'worker@org.com',
      sydney(2026, 10, 24, 3, 0),
      sydney(2026, 10, 24, 5, 0),
      ORG,
    );

    expect(result.hasConflict).toBe(false);
  });

  test('allows a daytime proposal that does not overlap the night slot', async () => {
    const result = await SchedulerService.checkAssignmentConflicts(
      'worker@org.com',
      sydney(2026, 10, 23, 10, 0),
      sydney(2026, 10, 23, 12, 0),
      ORG,
    );

    expect(result.hasConflict).toBe(false);
  });

  test('scopes the assignment lookup to the organisation', async () => {
    await SchedulerService.checkAssignmentConflicts(
      'worker@org.com',
      sydney(2026, 10, 23, 10, 0),
      sydney(2026, 10, 23, 12, 0),
      ORG,
    );

    expect(ClientAssignment.find).toHaveBeenCalledWith({
      userEmail: 'worker@org.com',
      isActive: true,
      organizationId: ORG,
    });
  });
});
