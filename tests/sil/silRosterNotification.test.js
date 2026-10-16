/**
 * Tests for the SIL roster publish notifications (SIL_MANAGEMENT_SPEC §4).
 *
 * Models and FCM are mocked; the service logic is exercised directly. The
 * `publishRoster` wiring (only notify on the draft -> published transition) is
 * covered in silRosterPublishNotification.test.js, which mocks this service.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

// The FCM boundary is `firebase-admin-config`, NOT `config/firebase`. Replacing
// the whole of `config/firebase` with a hand-written `{ sendMulticastNotification }`
// is what let a real production bug through: the service called the method on the
// module wrapper instead of on the exported `firebaseConfig` singleton, so every
// push threw "... is not a function" and was dropped while this suite stayed
// green. Requiring the real module keeps its export shape under test.
jest.mock('../../firebase-admin-config', () => ({
  admin: {},
  messaging: {
    send: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    sendEachForMulticast: jest.fn(),
  },
}));

jest.mock('../../models/SILProperty', () => ({ findOne: jest.fn() }));
jest.mock('../../models/UserOrganization', () => ({ find: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn() }));
jest.mock('../../models/Notification', () => ({
  insertMany: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('../../models/NotificationPreference', () => ({ find: jest.fn() }));
jest.mock('../../models/FcmToken', () => ({ find: jest.fn() }));

const SILProperty = require('../../models/SILProperty');
const UserOrganization = require('../../models/UserOrganization');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const NotificationPreference = require('../../models/NotificationPreference');
const FcmToken = require('../../models/FcmToken');
const firebaseModule = require('../../config/firebase');
const { messaging } = require('../../firebase-admin-config');

const notificationService = require('../../services/silRosterNotificationService');

const ORG = '507f1f77bcf86cd799439011';
const WORKER_A = '507f1f77bcf86cd799439021';
const WORKER_B = '507f1f77bcf86cd799439022';
const OWNER = '507f1f77bcf86cd799439023';

/** `Model.find(...).select(...).lean()` chain. */
const leanFind = (docs) => ({
  select: () => ({ lean: async () => docs }),
});

/**
 * Filter-aware `User.find` stand-in: resolves the documents whose `_id` the
 * query asked for. A blanket mock would hand the rostered-staff lookup the
 * admin row too (and vice versa), which silently breaks the compulsory/optional
 * split this service exists to make.
 */
const userFindImpl = (users) => (query = {}) => {
  const ids = (query?._id?.$in || []).map(String);
  const docs = ids.length
    ? users.filter((u) => ids.includes(String(u._id)))
    : users;
  return leanFind(docs);
};

beforeEach(() => {
  jest.clearAllMocks();
  UserOrganization.find.mockReturnValue({ lean: async () => [] });
  User.find.mockImplementation(userFindImpl([]));
  Notification.insertMany.mockResolvedValue([]);
  Notification.updateMany.mockResolvedValue({});
  NotificationPreference.find.mockReturnValue({ lean: async () => [] });
  FcmToken.find.mockReturnValue({ lean: async () => [] });
  messaging.sendEachForMulticast.mockResolvedValue({
    successCount: 1,
    failureCount: 0,
    responses: [],
  });
  SILProperty.findOne.mockReturnValue({
    select: () => ({ lean: async () => ({ name: 'Richmond House' }) }),
  });
});

describe('resolveRecipients', () => {
  test('notifies rostered staff and marks owner/admin as compulsory', async () => {
    UserOrganization.find.mockReturnValue({
      lean: async () => [
        { userId: OWNER, role: 'owner', permissions: ['*'] },
      ],
    });
    User.find.mockImplementation(
      userFindImpl([
        { _id: WORKER_A, email: 'worker.a@org.com' },
        { _id: OWNER, email: 'owner@org.com' },
      ])
    );

    const recipients = await notificationService.resolveRecipients(ORG, [
      WORKER_A,
    ]);

    const byEmail = Object.fromEntries(
      recipients.map((r) => [r.email, r.compulsory])
    );
    expect(byEmail['worker.a@org.com']).toBe(false);
    expect(byEmail['owner@org.com']).toBe(true);
  });

  test('deduplicates a rosterer who is also the owner', async () => {
    UserOrganization.find.mockReturnValue({
      lean: async () => [{ userId: OWNER, role: 'admin', permissions: ['*'] }],
    });
    User.find.mockImplementation(
      userFindImpl([{ _id: OWNER, email: 'owner@org.com' }])
    );

    const recipients = await notificationService.resolveRecipients(ORG, [
      OWNER,
    ]);

    expect(recipients).toHaveLength(1);
    // Compulsory wins: the same person must not be demoted to opt-out-able.
    expect(recipients[0].compulsory).toBe(true);
  });
});

describe('notifyRosterPublished', () => {
  const roster = {
    _id: '507f1f77bcf86cd799439031',
    propertyId: '507f1f77bcf86cd799439041',
    weekStarting: new Date('2026-10-12T00:00:00Z'),
    entries: [
      { staffUserIds: [WORKER_A, WORKER_B] },
      { staffUserIds: [WORKER_A] },
    ],
  };

  test('persists one notification per recipient and pushes to device tokens', async () => {
    UserOrganization.find.mockReturnValue({
      lean: async () => [{ userId: OWNER, role: 'owner', permissions: ['*'] }],
    });
    User.find.mockImplementation(
      userFindImpl([
        { _id: WORKER_A, email: 'worker.a@org.com' },
        { _id: WORKER_B, email: 'worker.b@org.com' },
        { _id: OWNER, email: 'owner@org.com' },
      ])
    );
    FcmToken.find.mockReturnValue({
      lean: async () => [{ fcmToken: 'tok-android' }, { fcmToken: 'tok-ios' }],
    });
    messaging.sendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [],
    });

    const result = await notificationService.notifyRosterPublished({
      organizationId: ORG,
      roster,
      actor: 'admin@org.com',
    });

    expect(result.delivered).toBe(3);
    expect(result.pushed).toBe(2);
    expect(Notification.insertMany).toHaveBeenCalledTimes(1);
    expect(Notification.insertMany.mock.calls[0][0]).toHaveLength(3);

    // The sender must resolve through the exported singleton. This assertion is
    // the guard for the bug that shipped: the module object has no
    // `sendMulticastNotification`, so calling it there dropped every push.
    expect(typeof firebaseModule.firebaseConfig?.sendMulticastNotification).toBe(
      'function'
    );

    const message = messaging.sendEachForMulticast.mock.calls[0][0];
    expect(message.tokens).toEqual(['tok-android', 'tok-ios']);
    expect(message.data.type).toBe('sil_roster');
    expect(message.data.rosterId).toBe(String(roster._id));
    expect(message.data.channelId).toBe('rosters');
    expect(message.notification.title).toBe('Roster published');
    expect(message.notification.body).toContain('Richmond House');
    expect(message.notification.body).toContain('2026-10-12');
    // Both platforms configured in the same call.
    expect(message.android.notification.channelId).toBe('rosters');
    expect(message.apns.headers['apns-priority']).toBe('10');
    expect(message.apns.payload.aps.alert.title).toBe('Roster published');
  });

  test('owner/admin still receives it when they opted out of shift-change alerts', async () => {
    UserOrganization.find.mockReturnValue({
      lean: async () => [{ userId: OWNER, role: 'admin', permissions: ['*'] }],
    });
    User.find.mockImplementation(
      userFindImpl([
        { _id: OWNER, email: 'owner@org.com' },
        { _id: WORKER_A, email: 'worker.a@org.com' },
      ])
    );
    NotificationPreference.find.mockReturnValue({
      lean: async () => [
        {
          userId: String(OWNER),
          categoryEnabled: { shiftChanges: false },
        },
        {
          userId: String(WORKER_A),
          categoryEnabled: { shiftChanges: false },
        },
      ],
    });

    const result = await notificationService.notifyRosterPublished({
      organizationId: ORG,
      roster,
    });

    expect(result.delivered).toBe(1);
    const inserted = Notification.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(String(inserted[0].userId)).toBe(OWNER);
  });

  test('never throws when push delivery fails (history is still written)', async () => {
    User.find.mockImplementation(
      userFindImpl([{ _id: WORKER_A, email: 'worker.a@org.com' }])
    );
    FcmToken.find.mockReturnValue({
      lean: async () => [{ fcmToken: 'tok-1' }],
    });
    messaging.sendEachForMulticast.mockRejectedValue(new Error('FCM down'));

    const result = await notificationService.notifyRosterPublished({
      organizationId: ORG,
      roster,
    });

    expect(result.delivered).toBe(1);
    expect(result.pushed).toBe(0);
    expect(Notification.insertMany).toHaveBeenCalledTimes(1);
  });

  test('returns zero recipients when the roster names nobody and there are no admins', async () => {
    const result = await notificationService.notifyRosterPublished({
      organizationId: ORG,
      roster: { ...roster, entries: [] },
    });

    expect(result).toEqual({ delivered: 0, pushed: 0 });
    expect(Notification.insertMany).not.toHaveBeenCalled();
  });
});
