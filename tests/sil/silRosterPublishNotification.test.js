/**
 * Wiring test for `silRosterService.publishRoster` -> roster publish
 * notifications.
 *
 * Kept in its own file because it mocks `silRosterNotificationService` itself;
 * silRosterNotification.test.js exercises that service for real and cannot share
 * a module registry with a mock of it.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/SILRoster', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Organization', () => ({ findOne: jest.fn() }));
jest.mock('../../models/SILProperty', () => ({ findOne: jest.fn() }));
jest.mock('../../models/SILOccupancy', () => ({ find: jest.fn() }));
jest.mock('../../models/Shift', () => ({ find: jest.fn() }));
jest.mock('../../services/silRatioService', () => ({
  requiredStaff: jest.fn(),
}));
jest.mock('../../services/silRosterNotificationService', () => ({
  notifyRosterPublished: jest.fn().mockResolvedValue({
    delivered: 1,
    pushed: 1,
  }),
}));

const SILRoster = require('../../models/SILRoster');
const {
  notifyRosterPublished,
} = require('../../services/silRosterNotificationService');
const silRosterService = require('../../services/silRosterService');

/** Let the un-awaited fire-and-forget dispatch run before asserting. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const roster = (overrides = {}) => ({
  _id: 'r1',
  status: 'draft',
  entries: [],
  ratioWarnings: [],
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  notifyRosterPublished.mockResolvedValue({ delivered: 1, pushed: 1 });
});

describe('publishRoster notifications', () => {
  test('dispatches the notification on the draft -> published transition', async () => {
    SILRoster.findOne.mockResolvedValue(roster());

    const result = await silRosterService.publishRoster('org1', 'r1', {}, 'admin@org.com');
    await flush();

    expect(result.blocked).toBeUndefined();
    expect(notifyRosterPublished).toHaveBeenCalledTimes(1);
    expect(notifyRosterPublished.mock.calls[0][0]).toMatchObject({
      organizationId: 'org1',
      actor: 'admin@org.com',
    });
  });

  test('does not re-notify when an already-published roster is published again', async () => {
    SILRoster.findOne.mockResolvedValue(roster({ status: 'published' }));

    await silRosterService.publishRoster('org1', 'r1', {});
    await flush();

    expect(notifyRosterPublished).not.toHaveBeenCalled();
  });

  test('does not notify when the publish is blocked by a ratio breach', async () => {
    SILRoster.findOne.mockResolvedValue(
      roster({ entries: [{ compliance: 'understaffed' }] })
    );

    const result = await silRosterService.publishRoster('org1', 'r1', {
      blockOnRatioBreach: true,
    });
    await flush();

    expect(result.blocked).toBe(true);
    expect(notifyRosterPublished).not.toHaveBeenCalled();
  });

  test('publishing still succeeds when the notification dispatch rejects', async () => {
    SILRoster.findOne.mockResolvedValue(roster());
    notifyRosterPublished.mockRejectedValue(new Error('dispatch exploded'));

    const result = await silRosterService.publishRoster('org1', 'r1', {});
    await flush();

    expect(result.roster.status).toBe('published');
  });
});
