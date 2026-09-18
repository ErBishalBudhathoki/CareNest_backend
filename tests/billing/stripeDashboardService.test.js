process.env.STRIPE_SECRET_KEY = 'sk_test_mock';

const { Invoice } = require('../../models/Invoice');
const Organization = require('../../models/Organization');
const stripeDashboardService = require('../../services/billing/stripeDashboardService');

jest.mock('../../models/Invoice');
jest.mock('../../models/Organization');

const mockStripe = {
  accounts: {
    retrieve: jest.fn(),
    listExternalAccounts: jest.fn(),
  },
  balance: {
    retrieve: jest.fn(),
  },
  payouts: {
    list: jest.fn(),
  },
  refunds: {
    list: jest.fn(),
    create: jest.fn(),
  },
  disputes: {
    list: jest.fn(),
  },
};

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripe));

// jest automock does not stub Mongoose statics — assign explicitly.
// Supports both direct await and `.select().sort().limit().lean()` chains.
function queryMock(value) {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.sort = () => q;
  q.limit = () => q;
  q.lean = () => Promise.resolve(value);
  return q;
}

let findResult = [];
let findOneResult = null;

Organization.findById = jest.fn();
Invoice.find = jest.fn().mockImplementation(() => queryMock(findResult));
Invoice.findOne = jest.fn().mockImplementation(() => queryMock(findOneResult));

const ORG_ID = 'org-123';
const orgDoc = {
  _id: ORG_ID,
  stripeAccountId: 'acct_123',
  name: 'Test Org',
  subscription: { connectedAt: new Date('2026-01-01') },
};

describe('stripeDashboardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENABLE_INAPP_REFUNDS;
    findResult = [];
    findOneResult = null;
    Organization.findById.mockResolvedValue(orgDoc);
  });

  test('overview throws STRIPE_NOT_CONNECTED without linked account', async () => {
    Organization.findById.mockResolvedValue({ _id: ORG_ID });
    await expect(
      stripeDashboardService.getAccountOverview({ organizationId: ORG_ID })
    ).rejects.toMatchObject({ code: 'STRIPE_NOT_CONNECTED' });
  });

  test('overview maps account flags and requirement labels', async () => {
    mockStripe.accounts.retrieve.mockResolvedValue({
      charges_enabled: true,
      details_submitted: true,
      payouts_enabled: false,
      requirements: {
        disabled_reason: null,
        currently_due: ['external_account', 'custom_field_xyz'],
      },
      business_profile: { name: 'Test Org Pty' },
      email: 'billing@test.org',
      country: 'AU',
      default_currency: 'aud',
    });

    const result = await stripeDashboardService.getAccountOverview({
      organizationId: ORG_ID,
    });

    expect(mockStripe.accounts.retrieve).toHaveBeenCalledWith('acct_123');
    expect(result.chargesEnabled).toBe(true);
    expect(result.payoutsEnabled).toBe(false);
    expect(result.requirementsDue).toEqual([
      { code: 'external_account', label: 'Bank account for payouts' },
      { code: 'custom_field_xyz', label: 'custom field xyz' },
    ]);
    expect(result.refundsEnabled).toBe(false);
  });

  test('balance converts cents to dollars with uppercase currency', async () => {
    mockStripe.balance.retrieve.mockResolvedValue({
      available: [{ currency: 'aud', amount: 150250 }],
      pending: [{ currency: 'aud', amount: 4999 }],
    });

    const result = await stripeDashboardService.getBalance({
      organizationId: ORG_ID,
    });

    expect(mockStripe.balance.retrieve).toHaveBeenCalledWith({
      stripeAccount: 'acct_123',
    });
    expect(result.available).toEqual([{ currency: 'AUD', amount: 1502.5 }]);
    expect(result.pending).toEqual([{ currency: 'AUD', amount: 49.99 }]);
  });

  test('revenue aggregates paid invoices by day and fills gaps', async () => {
    const today = new Date();
    findResult = [
      { payment: { paidAmount: 100, paidDate: today } },
      { payment: { paidAmount: 50.5, paidDate: today } },
      { payment: { paidAmount: 20, paidDate: null } },
    ];

    const result = await stripeDashboardService.getRevenueSeries({
      organizationId: ORG_ID,
      days: 7,
    });

    expect(result.series).toHaveLength(7);
    expect(result.total).toBe(150.5);
    expect(result.invoiceCount).toBe(3);
    expect(result.series[6].total).toBe(150.5);
    expect(result.series[0].total).toBe(0);
  });

  test('risk maps refunds and disputes to org invoices only', async () => {
    mockStripe.refunds.list.mockResolvedValue({
      data: [
        {
          id: 're_1',
          amount: 5000,
          currency: 'aud',
          reason: 'requested_by_customer',
          status: 'succeeded',
          created: 1700000000,
          payment_intent: 'pi_1',
        },
      ],
    });
    mockStripe.disputes.list.mockResolvedValue({
      data: [
        {
          id: 'dp_1',
          amount: 9000,
          currency: 'aud',
          reason: 'fraudulent',
          status: 'needs_response',
          evidence_details: { due_by: 1700100000 },
          created: 1700000100,
          payment_intent: 'pi_2',
        },
      ],
    });
    Invoice.findOne
      .mockImplementationOnce(() => queryMock({ _id: 'inv-1', invoiceNumber: 'INV-1' }))
      .mockImplementationOnce(() => queryMock(null));

    const result = await stripeDashboardService.getRisk({
      organizationId: ORG_ID,
    });

    // Both lookups scoped to the organisation.
    for (const call of Invoice.findOne.mock.calls) {
      expect(call[0].organizationId).toBe(ORG_ID);
    }
    expect(result.refunds[0]).toMatchObject({
      id: 're_1',
      kind: 'refund',
      amount: 50,
      invoiceNumber: 'INV-1',
    });
    expect(result.disputes[0]).toMatchObject({
      id: 'dp_1',
      kind: 'dispute',
      amount: 90,
      invoiceId: null,
    });
  });

  test('createRefund throws REFUNDS_DISABLED when flag is off', async () => {
    await expect(
      stripeDashboardService.createRefund({
        organizationId: ORG_ID,
        invoiceId: 'inv-1',
        amount: 10,
      })
    ).rejects.toMatchObject({ code: 'REFUNDS_DISABLED' });
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  test('createRefund validates amount against refundable total', async () => {
    process.env.ENABLE_INAPP_REFUNDS = 'true';
    findOneResult = {
      _id: 'inv-1',
      organizationId: ORG_ID,
      payment: {
        paidAmount: 100,
        transactions: [
          { method: 'stripe', reference: 'pi_1', status: 'success', amount: 100 },
        ],
      },
      financialSummary: { totalAmount: 100 },
      save: jest.fn(),
    };

    await expect(
      stripeDashboardService.createRefund({
        organizationId: ORG_ID,
        invoiceId: 'inv-1',
        amount: 150,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REFUND_AMOUNT' });
  });

  test('createRefund issues partial refund and updates ledger', async () => {
    process.env.ENABLE_INAPP_REFUNDS = 'true';
    const save = jest.fn();
    findOneResult = {
      _id: 'inv-1',
      organizationId: ORG_ID,
      payment: {
        paidAmount: 100,
        status: 'paid',
        transactions: [
          { method: 'stripe', reference: 'pi_1', status: 'success', amount: 100 },
        ],
      },
      financialSummary: { totalAmount: 100 },
      save,
    };
    mockStripe.refunds.create.mockResolvedValue({
      id: 're_9',
      status: 'succeeded',
      currency: 'aud',
    });

    const result = await stripeDashboardService.createRefund({
      organizationId: ORG_ID,
      invoiceId: 'inv-1',
      amount: 30,
    });

    expect(mockStripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 3000 }),
      { stripeAccount: 'acct_123' }
    );
    expect(result).toMatchObject({
      refundId: 're_9',
      amount: 30,
      paymentStatus: 'partial',
      newPaidAmount: 70,
      balanceDue: 30,
    });
    expect(save).toHaveBeenCalled();
  });
});
