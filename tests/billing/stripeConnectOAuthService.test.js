process.env.STRIPE_SECRET_KEY = 'sk_test_mock';

const OAuthState = require('../../models/billing/OAuthState');
const Organization = require('../../models/Organization');
const stripeConnectOAuthService = require('../../services/billing/stripeConnectOAuthService');

jest.mock('../../models/billing/OAuthState');
jest.mock('../../models/Organization');

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    oauth: {
      token: jest.fn(),
    },
    accounts: {
      retrieve: jest.fn(),
    },
  }));
});

const stripe = require('stripe')();

describe('StripeConnectOAuthService', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a state-bound authorization URL', async () => {
    process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test_1';
    process.env.STRIPE_CONNECT_REDIRECT_URI = 'https://api.example.com/public/connect/oauth/callback';

    const result = await stripeConnectOAuthService.createAuthorizationUrl({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.url).toContain('connect.stripe.com');
    expect(result.url).toContain('client_id=ca_test_1');
    expect(result.url).toContain('state=');
    expect(OAuthState.create).toHaveBeenCalled();
  });

  test('exchanges a valid code and state', async () => {
    process.env.STRIPE_CONNECT_REDIRECT_URI = 'https://api.example.com/public/connect/oauth/callback';

    const stateDoc = {
      _id: 'state-1',
      organizationId: 'org-1',
      initiatingUserId: 'user-1',
      expiresAt: new Date(Date.now() + 60 * 1000),
      consumedAt: null,
      save: jest.fn().mockResolvedValue(true),
    };
    OAuthState.findOne.mockResolvedValue(stateDoc);

    stripe.oauth.token.mockResolvedValue({ stripe_user_id: 'acct_1' });
    stripe.accounts.retrieve.mockResolvedValue({
      id: 'acct_1',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    });

    const result = await stripeConnectOAuthService.consumeStateAndExchange({
      code: 'code-1',
      state: 'state-1',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.stripeAccountId).toBe('acct_1');
    expect(Organization.updateOne).toHaveBeenCalledWith(
      { _id: 'org-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          stripeAccountId: 'acct_1',
        }),
      })
    );
    expect(stateDoc.consumedAt).toBeTruthy();
  });

  test('rejects a reused state', async () => {
    OAuthState.findOne.mockResolvedValue({
      consumedAt: new Date(),
    });

    await expect(
      stripeConnectOAuthService.consumeStateAndExchange({
        code: 'code-1',
        state: 'state-1',
        organizationId: 'org-1',
        userId: 'user-1',
      })
    ).rejects.toThrow('Invalid or already-used OAuth state');
  });
});
