process.env.STRIPE_SECRET_KEY = 'sk_test_mock';


const UserOrganization = require('../../models/UserOrganization');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const NotificationPreference = require('../../models/NotificationPreference');
const FcmToken = require('../../models/FcmToken');
const billingNotificationService = require('../../services/billing/billingNotificationService');

jest.mock('../../models/UserOrganization');
jest.mock('../../models/User');
jest.mock('../../models/Notification');
jest.mock('../../models/NotificationPreference');
jest.mock('../../models/FcmToken');
// Mock the FCM boundary (`firebase-admin-config`), NOT `config/firebase`.
// Replacing config/firebase with a hand-written `{ sendMulticastNotification }`
// is precisely what hid the bug this suite has to catch: the service called the
// method on the module wrapper instead of on the exported `firebaseConfig`
// singleton, so every push threw "... is not a function" while this test stayed
// green. Requiring the real module keeps its export shape under test.
jest.mock('../../firebase-admin-config', () => ({
  admin: {},
  messaging: {
    send: jest.fn().mockResolvedValue({ messageId: 'm1' }),
    sendEachForMulticast: jest.fn(),
  },
}));

const { messaging } = require('../../firebase-admin-config');

// jest automock does not stub Mongoose statics — assign explicitly.
// Supports both `await Model.find()` and `.select().sort().limit().lean()` chains.
function queryMock(value) {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.sort = () => q;
  q.limit = () => q;
  q.lean = () => Promise.resolve(value);
  return q;
}

let membershipDocs = [];
let userDocs = [];
let prefDocs = [];
let tokenDocs = [];

UserOrganization.find = jest.fn().mockImplementation(() => queryMock(membershipDocs));
User.find = jest.fn().mockImplementation(() => queryMock(userDocs));
Notification.insertMany = jest.fn();
Notification.updateMany = jest.fn();
NotificationPreference.find = jest.fn().mockImplementation(() => queryMock(prefDocs));
FcmToken.find = jest.fn().mockImplementation(() => queryMock(tokenDocs));

const ORG_ID = '64f000000000000000000001';
// mongoose is repo-mocked: assert against the same mock ObjectId the service builds.
const mongooseMock = require('mongoose');
const expectedOrgId = () => new mongooseMock.Types.ObjectId(ORG_ID);

function membership(userId, extra = {}) {
  return { userId, organizationId: ORG_ID, isActive: true, ...extra };
}

describe('billingNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    membershipDocs = [];
    userDocs = [];
    prefDocs = [];
    tokenDocs = [];
    Notification.insertMany.mockResolvedValue([]);
    Notification.updateMany.mockResolvedValue({});
    messaging.sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [],
    });
  });

  test('resolves only manage_billing holders, owners and admins in THIS org', async () => {
    // membershipDocs simulates what Mongo returns AFTER applying the query
    // filter (the mock cannot filter); the query-shape assertions below
    // prove the filter itself is correct.
    membershipDocs = [
      membership('u-billing', { permissions: ['read', 'manage_billing'] }),
      membership('u-owner', { role: 'owner', permissions: ['read'] }),
      membership('u-admin', { role: 'admin', permissions: ['read'] }),
    ];
    userDocs = [
      { _id: 'u-billing', email: 'Billing@Example.com' },
      { _id: 'u-owner', email: 'owner@example.com' },
      { _id: 'u-admin', email: 'admin@example.com' },
    ];

    const recipients = await billingNotificationService.resolveRecipients(ORG_ID);

    const query = UserOrganization.find.mock.calls[0][0];
    expect(query.organizationId).toEqual(expectedOrgId());
    expect(query.isActive).toBe(true);
    expect(query.$or).toEqual(
      expect.arrayContaining([
        { permissions: 'manage_billing' },
        { role: { $in: ['owner', 'admin'] } },
      ])
    );
    const emails = recipients.map((r) => r.email).sort();
    expect(emails).toEqual([
      'admin@example.com',
      'billing@example.com',
      'owner@example.com',
    ]);
  });

  test('never queries outside the given organisation', async () => {
    membershipDocs = [];
    await billingNotificationService.resolveRecipients(ORG_ID);
    const query = UserOrganization.find.mock.calls[0][0];
    expect(query.organizationId).toEqual(expectedOrgId());
    expect(query.isActive).toBe(true);
  });

  test('skips recipients who disabled billing notifications', async () => {
    membershipDocs = [
      membership('u-1', { role: 'admin' }),
      membership('u-2', { role: 'admin' }),
    ];
    userDocs = [
      { _id: 'u-1', email: 'one@example.com' },
      { _id: 'u-2', email: 'two@example.com' },
    ];
    prefDocs = [{ userId: 'u-2', categoryEnabled: { billing: false } }];
    tokenDocs = [];

    const result = await billingNotificationService.notifyInvoiceDisputed({
      organizationId: ORG_ID,
      invoice: { _id: 'inv-1', invoiceNumber: 'INV-1', clientName: 'Client' },
      reason: 'Wrong amount',
    });

    expect(result.delivered).toBe(1);
    const docs = Notification.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].priority).toBe('high');
    expect(docs[0].data.invoiceId).toBe('inv-1');
  });

  test('persists history even when push delivery throws', async () => {
    membershipDocs = [membership('u-1', { role: 'owner' })];
    userDocs = [{ _id: 'u-1', email: 'one@example.com' }];
    prefDocs = [];
    tokenDocs = [{ fcmToken: 'tok-1' }];
    messaging.sendEachForMulticast.mockRejectedValue(new Error('FCM down'));

    const result = await billingNotificationService.notifyPaymentReceived({
      organizationId: ORG_ID,
      invoice: { _id: 'inv-9', invoiceNumber: 'INV-9' },
      amount: 120.5,
      method: 'stripe',
    });

    expect(Notification.insertMany).toHaveBeenCalled();
    expect(result.delivered).toBe(1);
    expect(result.pushed).toBe(0);
  });

  test('push payload uses type invoice with kind specificity', async () => {
    membershipDocs = [membership('u-1', { role: 'owner' })];
    userDocs = [{ _id: 'u-1', email: 'one@example.com' }];
    prefDocs = [];
    tokenDocs = [{ fcmToken: 'tok-1' }];

    await billingNotificationService.notifyInvoiceApproved({
      organizationId: ORG_ID,
      invoice: { _id: 'inv-2', invoiceNumber: 'INV-2', clientName: 'Acme' },
      approvedBy: 'client@example.com',
    });

    // The shared sender hands FCM a single message object (tokens live inside),
    // so this asserts the payload FCM actually receives.
    const [message] = messaging.sendEachForMulticast.mock.calls[0];
    expect(message.data.type).toBe('invoice');
    expect(message.data.kind).toBe('invoice_approved');
    expect(message.data.invoiceId).toBe('inv-2');
    expect(message.data.channelId).toBe('payments');
    expect(message.tokens).toEqual(['tok-1']);
  });

  test('the payload reaches the real sender singleton, addressed to the tokens', async () => {
    membershipDocs = [membership('u-1', { role: 'owner' })];
    userDocs = [{ _id: 'u-1', email: 'one@example.com' }];
    prefDocs = [];
    tokenDocs = [{ fcmToken: 'tok-android' }, { fcmToken: 'tok-ios' }];
    messaging.sendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [],
    });

    const result = await billingNotificationService.notifyInvoiceApproved({
      organizationId: ORG_ID,
      invoice: { _id: 'inv-3', invoiceNumber: 'INV-3', clientName: 'Acme' },
      approvedBy: 'client@example.com',
    });

    // Before the fix this was 0: `firebaseConfig` was the module wrapper, which
    // has no `sendMulticastNotification`, so the send threw into the catch and
    // the push was lost while the in-app history row was still written.
    expect(result.pushed).toBe(2);
    expect(messaging.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const message = messaging.sendEachForMulticast.mock.calls[0][0];
    expect(message.tokens).toEqual(['tok-android', 'tok-ios']);
    expect(message.notification.title).toBeTruthy();
  });
});
