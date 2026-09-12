process.env.STRIPE_SECRET_KEY = 'sk_test_mock';

const HostedCheckoutGrant = require('../../models/billing/HostedCheckoutGrant');
const { Invoice } = require('../../models/Invoice');
const Organization = require('../../models/Organization');
const hostedCheckoutService = require('../../services/billing/hostedCheckoutService');

jest.mock('../../models/billing/HostedCheckoutGrant');
jest.mock('../../models/Invoice');
jest.mock('../../models/Organization');

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    accounts: {
      retrieve: jest.fn(),
    },
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
  }));
});

const stripe = require('stripe')();

describe('HostedCheckoutService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (!Invoice.findOne || !jest.isMockFunction(Invoice.findOne)) {
      Invoice.findOne = jest.fn();
    }
  });

  test('creates a grant for a payable invoice', async () => {
    Invoice.findOne.mockResolvedValue({
      financialSummary: { totalAmount: 100, currency: 'AUD' },
      payment: { paidAmount: 0 },
    });
    Organization.findById.mockResolvedValue({ stripeAccountId: 'acct_1' });
    stripe.accounts.retrieve.mockResolvedValue({
      details_submitted: true,
      charges_enabled: true,
    });

    HostedCheckoutGrant.create.mockResolvedValue({
      _id: 'grant-1',
      amountCents: 10000,
      currency: 'AUD',
      expiresAt: new Date(),
    });

    const { grant, plainToken } = await hostedCheckoutService.createGrant({
      organizationId: 'org-1',
      invoiceId: 'inv-1',
      createdBy: 'admin@example.com',
    });

    expect(grant.amountCents).toBe(10000);
    expect(plainToken).toBeTruthy();
    expect(HostedCheckoutGrant.create).toHaveBeenCalled();
  });

  test('rejects a non-payable invoice', async () => {
    Invoice.findOne.mockResolvedValue({
      financialSummary: { totalAmount: 100, currency: 'AUD' },
      payment: { paidAmount: 100 },
    });
    Organization.findById.mockResolvedValue({ stripeAccountId: 'acct_1' });
    stripe.accounts.retrieve.mockResolvedValue({
      details_submitted: true,
      charges_enabled: true,
    });

    await expect(
      hostedCheckoutService.createGrant({
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        createdBy: 'admin@example.com',
      })
    ).rejects.toThrow('Invoice has no payable balance');
  });

  test('rejects when the connected account is not fully onboarded', async () => {
    Invoice.findOne.mockResolvedValue({
      financialSummary: { totalAmount: 100, currency: 'AUD' },
      payment: { paidAmount: 0 },
    });
    Organization.findById.mockResolvedValue({ stripeAccountId: 'acct_1' });
    stripe.accounts.retrieve.mockResolvedValue({
      details_submitted: false,
      charges_enabled: false,
    });

    await expect(
      hostedCheckoutService.createGrant({
        organizationId: 'org-1',
        invoiceId: 'inv-1',
        createdBy: 'admin@example.com',
      })
    ).rejects.toThrow('Organization must complete Stripe Connect onboarding');
  });

  test('creates a Stripe Checkout session with allowlisted URLs', async () => {
    process.env.PAYMENT_PUBLIC_RETURN_URL = 'https://example.com/payment/success';
    process.env.PAYMENT_PUBLIC_CANCEL_URL = 'https://example.com/payment/cancel';

    const grant = {
      _id: 'grant-1',
      organizationId: 'org-1',
      invoiceId: 'inv-1',
      amountCents: 10000,
      currency: 'AUD',
      stripeAccountId: 'acct_1',
      status: 'active',
      expiresAt: new Date(Date.now() + 60 * 1000),
    };

    HostedCheckoutGrant.findOne.mockResolvedValue(grant);
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'sess-1',
      url: 'https://checkout.stripe.com/...',
    });

    const result = await hostedCheckoutService.createCheckoutSession({
      plainToken: 'plain-token',
      successUrl: 'https://example.com/payment/success',
      cancelUrl: 'https://example.com/payment/cancel',
    });

    expect(result.url).toBe('https://checkout.stripe.com/...');
    expect(HostedCheckoutGrant.updateOne).toHaveBeenCalled();
  });

  test('rejects a session with an invalid return URL', async () => {
    process.env.PAYMENT_PUBLIC_RETURN_URL = 'https://example.com/payment/success';
    process.env.PAYMENT_PUBLIC_CANCEL_URL = 'https://example.com/payment/cancel';

    HostedCheckoutGrant.findOne.mockResolvedValue({
      status: 'active',
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    await expect(
      hostedCheckoutService.createCheckoutSession({
        plainToken: 'plain-token',
        successUrl: 'https://evil.com/success',
        cancelUrl: 'https://example.com/payment/cancel',
      })
    ).rejects.toThrow('Return URLs are not in the allowlist');
  });
});
