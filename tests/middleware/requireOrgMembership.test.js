/**
 * requireOrgMembership: contradictory tenant hints must be rejected before
 * any membership lookup, and valid ones must delegate to the existing
 * organizationContextMiddleware (403 for non-members, next() for members).
 */
const express = require('express');
const request = require('supertest');

const mockUserOrgFindOne = jest.fn();
jest.mock('../../models/UserOrganization', () => ({
  findOne: (...args) => mockUserOrgFindOne(...args),
}));

jest.mock('../../utils/errorHandler', () => ({
  createErrorResponse: (message, statusCode, code) => ({ success: false, message, code }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), security: jest.fn(),
  }),
}));

const { requireOrgMembership } = require('../../middleware/requireOrgMembership');

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { userId: 'user-1', email: 'u@example.com' };
    next();
  });
  app.get('/t', requireOrgMembership, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireOrgMembership', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects header/query organizationId conflict with 400', async () => {
    const res = await request(buildApp())
      .get('/t?organizationId=org-B')
      .set('x-organization-id', 'org-A');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORG_ID_CONFLICT');
    expect(mockUserOrgFindOne).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not an active member of the org', async () => {
    mockUserOrgFindOne.mockResolvedValue(null);
    const res = await request(buildApp()).get('/t?organizationId=org-B');
    expect(res.status).toBe(403);
  });

  it('passes and attaches organizationContext for a member', async () => {
    mockUserOrgFindOne.mockResolvedValue({
      userId: 'user-1', organizationId: 'org-A', role: 'admin', permissions: [], isActive: true,
    });
    const app = express();
    app.use((req, _res, next) => { req.user = { userId: 'user-1' }; next(); });
    app.get('/t', requireOrgMembership, (req, res) =>
      res.json({ ok: true, ctx: req.organizationContext && req.organizationContext.organizationId }));
    const res = await request(app).get('/t?organizationId=org-A');
    expect(res.status).toBe(200);
    expect(res.body.ctx).toBe('org-A');
  });
});
