/**
 * Receipt-reminder delivery regression: firebase-admin v12 removed the
 * admin.messaging() namespace API, which threw on every send and silently
 * zeroed all receipt reminders. Sends must go through the shared
 * config/firebase sender.
 */
const mockSend = jest.fn();

jest.mock('../../config/firebase', () => ({
  getMessaging: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
  getAdmin: jest.fn(),
}));

const mockFcmFindOne = jest.fn();
const mockExpenseUpdateOne = jest.fn();

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    topology: { isConnected: () => true },
    close: jest.fn().mockResolvedValue(undefined),
    db: jest.fn(() => ({
      collection: jest.fn((name) => {
        if (name === 'fcmTokens') return { findOne: mockFcmFindOne };
        if (name === 'expenses') return { updateOne: mockExpenseUpdateOne };
        return { insertOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
      }),
    })),
  })),
  ServerApiVersion: { v1: '1' },
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const { sendReceiptReminder } = require('../../services/expenseReminderService');

const expense = {
  _id: '507f1f77bcf86cd799439011',
  amount: 120.5,
  category: 'Travel',
  submittedBy: 'user@x.com',
  createdAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
  organizationId: 'org-a',
};

describe('sendReceiptReminder delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFcmFindOne.mockResolvedValue({ fcmToken: 'fcm-token-1' });
    mockSend.mockResolvedValue('projects/x/messages/m1');
    mockExpenseUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  test('sends via the shared sender and tracks the reminder', async () => {
    const result = await sendReceiptReminder(expense);
    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.token).toBe('fcm-token-1');
    expect(message.data.expenseId).toBe(expense._id);
    expect(mockExpenseUpdateOne).toHaveBeenCalledWith(
      { _id: expense._id },
      expect.objectContaining({ $set: expect.objectContaining({ receiptReminderCount: 1 }) }),
    );
  });

  test('skips gracefully without an FCM token', async () => {
    mockFcmFindOne.mockResolvedValue(null);
    const result = await sendReceiptReminder(expense);
    expect(result.success).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
