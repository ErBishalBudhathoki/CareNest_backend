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
jest.mock('../../config/firebase', () => ({
  sendMulticastNotification: jest.fn(),
}));

const { sendMulticastNotification } = require('../../config/firebase');

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
    sendMulticastNotification.mockResolvedValue({ successCount: 1 });
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
    sendMulticastNotification.mockRejectedValue(new Error('FCM down'));

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

    const [, data] = sendMulticastNotification.mock.calls[0];
    expect(data.type).toBe('invoice');
    expect(data.kind).toBe('invoice_approved');
    expect(data.invoiceId).toBe('inv-2');
    expect(data.channelId).toBe('payments');
  });
});
