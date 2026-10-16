/**
 * Timesheet-reminder delivery regression.
 *
 * `sendTimesheetReminder` used to call `getMessaging()` on the `config/firebase`
 * *module wrapper* instead of on the `firebaseConfig` singleton it exports. The
 * wrapper has no such method, so every send threw
 * "firebase.getMessaging is not a function" into the surrounding catch: the
 * reminder was logged as a failure and no push was ever delivered.
 *
 * The FCM boundary mocked here is `firebase-admin-config`, NOT
 * `config/firebase`, so the real module's export shape stays under test — a
 * hand-written `{ getMessaging }` module mock is what let the bug ship.
 */
const mockSend = jest.fn();

jest.mock('../../firebase-admin-config', () => ({
  admin: {},
  messaging: { send: (...args) => mockSend(...args) },
}));

jest.mock('../../models/FcmToken', () => ({ findOne: jest.fn() }));
jest.mock('../../models/ReminderLog', () => ({ create: jest.fn() }));

const FcmToken = require('../../models/FcmToken');
const ReminderLog = require('../../models/ReminderLog');
const {
  sendTimesheetReminder,
} = require('../../services/timesheetReminderService');

const ORG = '507f1f77bcf86cd799439011';
const EMAIL = 'worker@org.com';
const details = {
  scheduledShifts: 5,
  completedShifts: 3,
  missingEntries: 2,
};

describe('sendTimesheetReminder delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FcmToken.findOne.mockResolvedValue({ fcmToken: 'fcm-token-1' });
    ReminderLog.create.mockResolvedValue({});
    mockSend.mockResolvedValue('projects/x/messages/m1');
  });

  test('delivers through the shared sender and logs the reminder', async () => {
    const result = await sendTimesheetReminder(EMAIL, ORG, details);

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const message = mockSend.mock.calls[0][0];
    expect(message.token).toBe('fcm-token-1');
    expect(message.data.type).toBe('timesheet_reminder');
    expect(message.data.organizationId).toBe(ORG);
    expect(message.data.missingEntries).toBe('2');
    expect(message.notification.title).toContain('Timesheet Reminder');
    // Android channel + APNs alert, so the same call reaches both platforms.
    expect(message.android.notification.channel_id).toBe('timesheet_reminders');
    expect(message.apns.payload.aps.sound).toBe('default');

    expect(ReminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'timesheet_reminder',
        userEmail: EMAIL,
        organizationId: ORG,
      })
    );
  });

  test('reports failure instead of throwing when FCM rejects', async () => {
    mockSend.mockRejectedValue(new Error('FCM down'));

    const result = await sendTimesheetReminder(EMAIL, ORG, details);

    expect(result.success).toBe(false);
    expect(result.error).toBe('FCM down');
  });

  test('skips without a registered device token', async () => {
    FcmToken.findOne.mockResolvedValue(null);

    const result = await sendTimesheetReminder(EMAIL, ORG, details);

    expect(result).toEqual({ success: false, reason: 'no_fcm_token' });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
