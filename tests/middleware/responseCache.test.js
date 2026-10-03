const request = require('supertest');
const express = require('express');

// Mock the Valkey-backed cache so these tests are deterministic and do not need
// a running Redis. Each test starts from an empty store.
jest.mock('../../services/cacheService', () => {
  const store = new Map();
  return {
    __store: store,
    __reset: () => store.clear(),
    __hits: { get: 0, set: 0 },
    get: jest.fn(async function get(key) {
      this.__hits.get += 1;
      return store.has(key) ? store.get(key) : null;
    }),
    set: jest.fn(async function set(key, value) {
      this.__hits.set += 1;
      store.set(key, JSON.stringify(value));
      return 'OK';
    }),
    del: jest.fn(async (key) => {
      store.delete(key);
      return 1;
    }),
    clearPattern: jest.fn(async () => 0),
  };
});

const cacheService = require('../../services/cacheService');
const responseCache = require('../../middleware/responseCache');

function buildApp() {
  const app = express();

  // Stand in for apiSecurityGate: resolve an authenticated user, as the real gate
  // does, so the middleware sees req.user.
  app.use((req, _res, next) => {
    const email = req.headers['x-test-user'];
    if (email) req.user = { email };
    next();
  });

  app.use('/api', responseCache());

  let handlerCalls = 0;

  app.get('/api/dashboard/revenue-comparison', (req, res) => {
    handlerCalls += 1;
    res.json({ success: true, data: { value: handlerCalls } });
  });

  app.get('/api/invoices/list', (req, res) => {
    handlerCalls += 1;
    res.json({ success: true, data: { value: handlerCalls } });
  });

  app.get('/api/dashboard/boom', (req, res) => {
    handlerCalls += 1;
    res.status(500).json({ success: false, message: 'kaboom' });
  });

  app.get('/api/dashboard/soft-fail', (req, res) => {
    handlerCalls += 1;
    res.json({ success: false, message: 'nope' });
  });

  app.get('/api/dashboard/slow', async (req, res) => {
    handlerCalls += 1;
    // Long enough that all concurrent supertest connections are established
    // before this handler can respond. With a short delay the requests arrive
    // fast enough to straddle the handler finishing, which makes the assertion
    // a test of supertest's connection scheduling rather than of coalescing.
    await new Promise((r) => setTimeout(r, 300));
    res.json({ success: true, data: { value: handlerCalls } });
  });

  return { app, calls: () => handlerCalls };
}

beforeEach(() => {
  cacheService.__reset();
  cacheService.__hits.get = 0;
  cacheService.__hits.set = 0;
  responseCache.inflight.clear();
});

describe('responseCache', () => {
  test('allowlisted GET is cached and replayed', async () => {
    const { app, calls } = buildApp();

    const first = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    const second = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'a@b.com');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(calls()).toBe(1); // handler ran once
    expect(cacheService.__hits.set).toBe(1);
  });

  test('a different organisation is never served another orgs entry', async () => {
    const { app, calls } = buildApp();

    const org1 = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    const org2 = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org2')
      .set('x-test-user', 'a@b.com');

    expect(org2.body.data.value).not.toBe(org1.body.data.value);
    expect(calls()).toBe(2);
  });

  test('a different user is never served another users entry', async () => {
    const { app, calls } = buildApp();

    const u1 = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    const u2 = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'other@b.com');

    expect(u2.body.data.value).not.toBe(u1.body.data.value);
    expect(calls()).toBe(2);
  });

  test('skips caching entirely when the organisation cannot be resolved', async () => {
    const { app, calls } = buildApp();

    await request(app)
      .get('/api/dashboard/revenue-comparison')
      .set('x-test-user', 'a@b.com');
    await request(app)
      .get('/api/dashboard/revenue-comparison')
      .set('x-test-user', 'a@b.com');

    expect(calls()).toBe(2); // never cached, because the tenant is unknown
    expect(cacheService.__hits.set).toBe(0);
  });

  test('skips caching when there is no authenticated user', async () => {
    const { app, calls } = buildApp();

    await request(app).get(
      '/api/dashboard/revenue-comparison?organizationId=org1'
    );
    await request(app).get(
      '/api/dashboard/revenue-comparison?organizationId=org1'
    );

    expect(calls()).toBe(2);
    expect(cacheService.__hits.set).toBe(0);
  });

  test('does not cache paths outside the allowlist', async () => {
    const { app, calls } = buildApp();

    await request(app)
      .get('/api/invoices/list?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    await request(app)
      .get('/api/invoices/list?organizationId=org1')
      .set('x-test-user', 'a@b.com');

    expect(calls()).toBe(2);
  });

  test('never caches a 5xx response', async () => {
    const { app } = buildApp();

    const r1 = await request(app)
      .get('/api/dashboard/boom?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    const r2 = await request(app)
      .get('/api/dashboard/boom?organizationId=org1')
      .set('x-test-user', 'a@b.com');

    expect(r1.status).toBe(500);
    expect(r2.status).toBe(500);
    expect(cacheService.__hits.set).toBe(0);
  });

  test('never caches success:false even on a 200', async () => {
    const { app } = buildApp();

    await request(app)
      .get('/api/dashboard/soft-fail?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    await request(app)
      .get('/api/dashboard/soft-fail?organizationId=org1')
      .set('x-test-user', 'a@b.com');

    // Only the success:true path is written.
    expect(cacheService.__hits.set).toBe(0);
  });

  test('collapses concurrent identical requests into one handler run', async () => {
    const { app, calls } = buildApp();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .get('/api/dashboard/slow?organizationId=org1')
          .set('x-test-user', 'a@b.com')
      )
    );

    expect(calls()).toBe(1);
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
    }
  });

  test('query parameter order does not fragment the cache', async () => {
    const { app, calls } = buildApp();

    await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1&days=30')
      .set('x-test-user', 'a@b.com');
    await request(app)
      .get('/api/dashboard/revenue-comparison?days=30&organizationId=org1')
      .set('x-test-user', 'a@b.com');

    expect(calls()).toBe(1);
  });

  test('different query values are cached separately', async () => {
    const { app, calls } = buildApp();

    await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1&days=30')
      .set('x-test-user', 'a@b.com');
    await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1&days=7')
      .set('x-test-user', 'a@b.com');

    expect(calls()).toBe(2);
  });

  test('a cache read failure degrades to an uncached response', async () => {
    const { app } = buildApp();

    cacheService.get.mockImplementationOnce(async () => {
      throw new Error('valkey down');
    });

    const r = await request(app)
      .get('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'a@b.com');

    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  test('a failing handler does not leave a permanently stuck in-flight entry', async () => {
    // Regression: if the originating request never reaches res.send, the
    // in-flight slot used to stay registered forever, so every later request for
    // that key awaited a promise that could never settle.
    const app = express();
    app.use((req, _res, next) => {
      if (req.headers['x-test-user']) req.user = { email: req.headers['x-test-user'] };
      next();
    });
    app.use('/api', responseCache());
    app.get('/api/dashboard/always-throws', () => {
      throw new Error('handler blew up');
    });
    app.get('/api/dashboard/ok', (req, res) => {
      res.json({ success: true, data: { ok: true } });
    });

    const failing = await request(app)
      .get('/api/dashboard/always-throws?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    expect(failing.status).toBeGreaterThanOrEqual(500);

    // The slot must be released; a healthy request afterwards still works.
    const healthy = await request(app)
      .get('/api/dashboard/ok?organizationId=org1')
      .set('x-test-user', 'a@b.com');
    expect(healthy.status).toBe(200);
    expect(healthy.body.success).toBe(true);
    expect(responseCache.inflight.size).toBe(0);
  });

  test('non-GET methods bypass the cache entirely', async () => {
    const { app } = buildApp();

    const r = await request(app)
      .post('/api/dashboard/revenue-comparison?organizationId=org1')
      .set('x-test-user', 'a@b.com');

    expect(r.status).toBe(404); // no POST route; the point is it did not hang or cache
    expect(cacheService.__hits.set).toBe(0);
  });
});

describe('responseCache helpers', () => {
  test('blocked prefixes are never cacheable', () => {
    expect(responseCache.ttlFor('/api/auth/login')).toBeNull();
    expect(responseCache.ttlFor('/api/active-timers/a@b.com')).toBeNull();
    expect(responseCache.ttlFor('/api/admin-dev/reset')).toBeNull();
  });

  test('allowed prefixes map to a TTL', () => {
    expect(responseCache.ttlFor('/api/dashboard/x')).toBe(60);
    expect(responseCache.ttlFor('/api/earnings/summary/x')).toBe(300);
    expect(responseCache.ttlFor('/api/analytics/pricing/x')).toBe(60);
    expect(responseCache.ttlFor('/api/billing/dashboard/overview')).toBe(30);
  });
});