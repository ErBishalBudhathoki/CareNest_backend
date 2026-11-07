/**
 * Regression test: admin-only financial surfaces are actually gated.
 *
 * These routers previously had `authenticateUser` + tenancy checks but no role
 * check, so any authenticated member of an organisation could connect Xero,
 * issue refunds, read the Stripe revenue dashboard or mint checkout grants.
 *
 * Equally important: the exemptions. `subscription_guard.dart` pushes
 * SubscriptionView to ANY member when a paywalled request returns 402, so
 * entitlement verification/status must stay reachable for workers and
 * participants. Personal bank details, Cloud Scheduler and signature-verified
 * webhooks are self-service / machine surfaces and must not be role-gated.
 *
 * This is a source-level contract test: it needs no database, no network and
 * no live server, so it runs in every CI job that has the repository.
 */
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');

function readRouteFile(relativePath) {
  return fs.readFileSync(path.join(ROUTES_DIR, relativePath), 'utf8');
}

/** Return the middleware chain text for one `router.<verb>('<path>', ...)`. */
function chainFor(source, verb, routePath) {
  const start = source.indexOf(`router.${verb}(`);
  if (start === -1) return null;
  // Find the specific call whose first argument is this path.
  const pattern = new RegExp(
    `router\\.${verb}\\(\\s*['"\`]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]([\\s\\S]*?)\\n\\);`,
    'g'
  );
  const match = pattern.exec(source);
  return match ? match[1] : null;
}

function expectGated(source, verb, routePath) {
  const chain = chainFor(source, verb, routePath);
  expect(chain).not.toBeNull();
  expect(chain).toContain('requireAdminSurface');
}

function expectOpen(source, verb, routePath) {
  const chain = chainFor(source, verb, routePath);
  expect(chain).not.toBeNull();
  expect(chain).not.toContain('requireAdminSurface');
}

describe('financial router admin gates', () => {
  describe('accounting (Xero / MYOB / QuickBooks)', () => {
    const source = readRouteFile('accounting.routes.js');

    test('router-level gate is installed after authentication and membership', () => {
      const authAt = source.indexOf('router.use(authenticateUser)');
      const membershipAt = source.indexOf('router.use(requireOrgMembership)');
      const gateAt = source.indexOf('router.use(requireAdminSurface)');
      expect(authAt).toBeGreaterThan(-1);
      expect(membershipAt).toBeGreaterThan(authAt);
      expect(gateAt).toBeGreaterThan(membershipAt);
    });

    test('organisation is pinned to the validated membership', () => {
      expect(source).toContain('router.use(requireMatchingOrganization)');
    });

    test.each(['/connect', '/callback', '/sync'])(
      '%s is a state-changing admin write covered by the router gate',
      (routePath) => {
        expect(source).toContain(`router.post('${routePath}'`);
      }
    );
  });

  describe('payments (Stripe Connect, intents, credit notes, refunds)', () => {
    const source = readRouteFile('paymentRoutes.js');

    test.each([
      '/create-intent',
      '/onboarding-link',
      '/connect-status',
      '/disconnect',
      '/record',
      '/credit-note',
      '/credit-note/apply',
      '/refund',
    ])('%s is admin-only', (routePath) => {
      const verb = routePath === '/connect-status' ? 'get' : 'post';
      expectGated(source, verb, routePath);
    });
  });

  describe('billing management', () => {
    const source = readRouteFile('billing/billingRoutes.js');

    test.each([
      ['post', '/entitlements/reset'],
      ['post', '/hosted-checkout/grant'],
      ['post', '/recurring-agreements'],
      ['get', '/recurring-agreements'],
      ['delete', '/recurring-agreements/:agreementId'],
      ['post', '/recurring/run'],
      ['post', '/connect/oauth/start'],
      ['get', '/dashboard/overview'],
      ['get', '/dashboard/balance'],
      ['get', '/dashboard/payouts'],
      ['get', '/dashboard/revenue'],
      ['get', '/dashboard/payments'],
      ['get', '/dashboard/risk'],
      ['post', '/dashboard/refund'],
    ])('%s %s is admin-only', (verb, routePath) => {
      expectGated(source, verb, routePath);
    });

    // subscription_guard.dart can push SubscriptionView to any member on a 402.
    test.each([
      ['post', '/entitlements/verify/apple'],
      ['post', '/entitlements/verify/google'],
      ['get', '/entitlements'],
    ])('%s %s stays reachable for non-admin members', (verb, routePath) => {
      expectOpen(source, verb, routePath);
    });

    test('public hosted checkout session is not role-gated', () => {
      expectOpen(source, 'post', '/public/checkout/session');
    });
  });

  describe('deliberately ungated self-service / machine surfaces', () => {
    test('personal bank details remain employee self-service', () => {
      const source = readRouteFile('bankDetails.js');
      expect(source).not.toContain('requireAdminSurface');
      expect(source).toContain("router.post('/saveBankDetails'");
      expect(source).toContain("router.get('/getBankDetails'");
    });

    test('Cloud Scheduler routes use machine authentication, not user roles', () => {
      const source = readRouteFile('scheduler_routes.js');
      expect(source).not.toContain('requireAdminSurface');
      expect(source).toContain('router.use(authenticateCloudScheduler)');
    });

    test('webhook routes are signature-verified, not role-gated', () => {
      const source = readRouteFile('webhookRoutes.js');
      expect(source).not.toContain('requireAdminSurface');
    });
  });

  describe('pricing / client plan gates are still in place', () => {
    test('pricing writes are admin-only but the read-only bulk lookup is exempt', () => {
      const source = readRouteFile('v1/pricing.js');
      expect(source).toContain('router.use(onStateChangingMethods(requireAdminSurface))');
      expect(source).toContain("const READ_ONLY_POST_PATHS = new Set(['/bulk-lookup'])");
    });

    test('participant NDIS plan updates are admin-only', () => {
      const source = readRouteFile('client.js');
      const chain = chainFor(source, 'put', '/client/:clientId/plan');
      expect(chain).not.toBeNull();
      expect(chain).toContain('requireAdminSurface');
    });
  });

  describe('organisation configuration writes', () => {
    // `updateOrganizationDetails` / `updateBranding` do `$set: req.body` over
    // the whole Organization document, including bankDetails and integrations.
    // Active membership is not an authorization boundary for those writes.
    const source = readRouteFile('v1/organization.js');

    test('the shared gate requires an admin role AND a matching organisation', () => {
      const gate = source.match(
        /const adminOrganizationWriteGate = \[([\s\S]*?)\];/
      );
      expect(gate).not.toBeNull();
      expect(gate[1]).toContain('requireAdminSurface');
      expect(gate[1]).toContain('requireMatchingOrganizationNoBodyPin');
    });

    test.each([
      ['put', '/:organizationId'],
      ['put', '/:organizationId/branding'],
      ['post', '/:organizationId/contact-email/send-verification'],
      ['post', '/:organizationId/contacct-email/send-verification'],
    ])('%s %s is admin-only and org-pinned', (verb, routePath) => {
      const chain = chainFor(source, verb, routePath);
      expect(chain).not.toBeNull();
      expect(chain).toContain('organizationContextMiddleware');
      expect(chain).toContain('...adminOrganizationWriteGate');
      expect(chain.indexOf('...adminOrganizationWriteGate')).toBeLessThan(
        chain.indexOf('organizationController.')
      );
    });

    test.each([
      ['get', '/:organizationId'],
      ['get', '/:organizationId/members'],
      ['get', '/:organizationId/branding'],
      ['post', '/:organizationId/switch'],
      ['post', '/create'],
      ['get', '/my-list'],
      ['post', '/verify-code'],
    ])('%s %s stays open to ordinary members', (verb, routePath) => {
      const chain = chainFor(source, verb, routePath);
      expect(chain).not.toBeNull();
      expect(chain).not.toContain('adminOrganizationWriteGate');
    });

    test('the raw update body is never mutated by the org matcher', () => {
      // Pinning req.body.organizationId would inject that field into `$set`.
      expect(source).toContain('requireMatchingOrganizationNoBodyPin');
      expect(source).not.toMatch(/requireMatchingOrganization\s*,/);
    });
  });
});
