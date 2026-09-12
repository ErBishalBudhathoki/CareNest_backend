const Entitlement = require('../../models/billing/Entitlement');
const Organization = require('../../models/Organization');
const entitlementService = require('../../services/billing/entitlementService');
const appleVerifier = require('../../services/billing/appleReceiptVerifier');
const googleVerifier = require('../../services/billing/googlePlayReceiptVerifier');

jest.mock('../../models/billing/Entitlement');
jest.mock('../../models/Organization');
jest.mock('../../services/billing/appleReceiptVerifier');
jest.mock('../../services/billing/googlePlayReceiptVerifier');

function mockQuery(val) {
  const query = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(val),
    exec: jest.fn().mockResolvedValue(val),
  };
  return query;
}

describe('EntitlementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Entitlement.findOneAndUpdate = jest.fn();
    Entitlement.findOne = jest.fn().mockImplementation(() => mockQuery(null));
    Organization.updateOne = jest.fn().mockResolvedValue({ nModified: 1 });
  });

  test('verifies Apple receipt and marks organization active', async () => {
    appleVerifier.verify.mockResolvedValue({
      source: 'apple_app_store',
      environment: 'sandbox',
      storeIdentifier: 'orig-txn-1',
      productId: 'ios_monthly',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isRevoked: false,
      isInBillingRetry: false,
      raw: { purchaseDate: Date.now() },
    });

    const entitlement = { _id: 'ent-1' };
    Entitlement.findOneAndUpdate.mockResolvedValue(entitlement);
    Entitlement.findOne.mockReturnValueOnce(
      mockQuery({
        _id: 'ent-1',
        status: 'active',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        graceEndsAt: new Date(Date.now() + 33 * 24 * 60 * 60 * 1000),
      })
    );

    const result = await entitlementService.verifyApple({
      organizationId: 'org-1',
      transactionJws: 'header.payload.signature',
      productId: 'ios_monthly',
    });

    expect(result.status.status).toBe('active');
    expect(Organization.updateOne).toHaveBeenCalledWith(
      { _id: 'org-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'subscription.status': 'active',
        }),
      })
    );
  });

  test('revoked Apple receipt produces revoked status', async () => {
    appleVerifier.verify.mockResolvedValue({
      source: 'apple_app_store',
      environment: 'production',
      storeIdentifier: 'orig-txn-2',
      productId: 'ios_monthly',
      expiresAt: new Date(Date.now() - 1000),
      isRevoked: true,
      isInBillingRetry: false,
      raw: {},
    });

    const entitlement = { _id: 'ent-2' };
    Entitlement.findOneAndUpdate.mockResolvedValue(entitlement);
    Entitlement.findOne
      .mockReturnValueOnce(mockQuery(null))
      .mockReturnValueOnce(mockQuery(null))
      .mockReturnValueOnce(mockQuery({ _id: 'ent-2' }));

    const result = await entitlementService.verifyApple({
      organizationId: 'org-1',
      transactionJws: 'header.payload.signature',
      productId: 'ios_monthly',
    });

    expect(result.status.status).toBe('expired');
  });

  test('Google subscription with grace period stays active', async () => {
    googleVerifier.verify.mockResolvedValue({
      source: 'google_play_store',
      environment: 'production',
      storeIdentifier: 'token-1',
      productId: 'android_monthly',
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      isRevoked: false,
      isInBillingRetry: true,
      raw: {},
    });

    Entitlement.findOneAndUpdate.mockResolvedValue({ _id: 'ent-3' });
    Entitlement.findOne.mockReturnValueOnce(
      mockQuery({
        _id: 'ent-3',
        status: 'billing_retry',
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        graceEndsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      })
    );

    const result = await entitlementService.verifyGoogle({
      organizationId: 'org-1',
      purchaseToken: 'token-1',
      subscriptionId: 'android_monthly',
    });

    expect(result.status.status).toBe('active');
  });
});
