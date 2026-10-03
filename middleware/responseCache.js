/**
 * Server-side read cache for the heavy dashboard/analytics endpoints.
 *
 * The Flutter client already collapses duplicate GETs and serves short-lived
 * reads from an in-memory cache, but every other consumer (other clients, curl,
 * monitoring, and the client's own cache-miss path) still hits Mongo for reads
 * that only change on the order of minutes.
 *
 * Design constraints, in priority order:
 *
 *  1. **Never leak across tenants.** Several of these routes take
 *     `organizationId` from the query string with no RBAC check (see
 *     routes/dashboardRoutes.js:18). The cache key therefore includes the
 *     authenticated user AND the organisation, and when either cannot be
 *     resolved the middleware skips caching entirely rather than guessing.
 *
 *  2. **Fail open.** A Valkey outage must degrade to uncached reads, never a 500.
 *
 *  3. **Never cache errors.** Only 2xx responses are stored.
 *
 *  4. **Only an explicit allowlist.** Never applied globally.
 *
 * Interception is done on `res.send`/`res.json` rather than on the raw
 * `res.write`/`res.end` stream. Those are the paths Express uses for buffered
 * JSON responses, and leaving the raw stream alone means streaming endpoints,
 * HEAD requests and the error handler keep working untouched.
 */

const cacheService = require('../services/cacheService');
const logger = require('../config/logger');

/** Prefix -> TTL in seconds. */
const CACHEABLE_PREFIXES = [
  ['/api/dashboard/', 60],
  ['/api/earnings/', 300],
  ['/api/analytics/', 60],
  ['/api/billing/dashboard/', 30],
  ['/api/workforce/bi/', 60],
];

/** Never cache these, whatever the prefix table says. */
const NEVER_CACHE = [
  '/api/auth',
  '/api/admin-dev',
  '/api/active-timers',
  '/api/realtime-portal',
  '/api/employee-tracking',
  '/api/ops',
];

const inflight = new Map();

/** Path only, query stripped. Matches against originalUrl so it is absolute. */
function pathOf(req) {
  const url = req.originalUrl || req.url || '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function queryOf(req) {
  const url = req.originalUrl || req.url || '';
  const q = url.indexOf('?');
  return q === -1 ? '' : url.slice(q + 1);
}

function ttlFor(path) {
  for (const blocked of NEVER_CACHE) {
    if (path.startsWith(blocked)) return null;
  }
  for (const [prefix, ttl] of CACHEABLE_PREFIXES) {
    if (path.startsWith(prefix)) return ttl;
  }
  return null;
}

/**
 * Identity for the cache entry, or null when it cannot be established.
 *
 * Both parts are required. Without the organisation we cannot prove the response
 * is not cross-tenant, because these routes trust the query parameter.
 */
function resolveScope(req) {
  const user =
    (req.user && (req.user.email || req.user.uid || req.user._id)) || null;
  if (!user) return null;

  // Defensive: middleware must never throw on an unexpected request shape.
  const query = req.query || {};
  const params = req.params || {};
  const orgContext = req.orgContext || {};

  const org =
    query.organizationId ||
    params.organizationId ||
    query.organization_id ||
    orgContext.organizationId ||
    orgContext.orgId ||
    null;
  if (!org) return null;

  return `${user}::${org}`;
}

function cacheKey(path, scope, query) {
  // Query parameters change the result (date ranges, bucket selectors), so they
  // belong in the key. Sorted so parameter order does not fragment the cache.
  const normalisedQuery = query
    ? query.split('&').filter(Boolean).sort().join('&')
    : '';
  return `http:resp:${scope}:${path}${normalisedQuery ? `?${normalisedQuery}` : ''}`;
}

/** Store only successful responses. Never let a cache failure reach the client. */
async function store(key, payload, ttl) {
  try {
    await cacheService.set(key, payload, ttl);
  } catch (error) {
    logger.warn('responseCache store failed', { error: error.message });
  }
}

function sendCached(res, entry) {
  if (entry.contentType) res.set('Content-Type', entry.contentType);
  return res.status(entry.status || 200).send(entry.body);
}

/**
 * Express middleware factory. Mount on the router that owns these routes:
 *   app.use('/api', responseCache());
 */
function responseCache() {
  return function responseCacheMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();

    const path = pathOf(req);
    const ttl = ttlFor(path);
    if (ttl === null) return next();

    const scope = resolveScope(req);
    if (!scope) return next();

    const key = cacheKey(path, scope, queryOf(req));

    // A duplicate request for the same key replays the first one's response
    // instead of issuing a second set of Mongo aggregations.
    const shared = inflight.get(key);
    if (shared) {
      shared.then(
        (entry) => {
          if (res.headersSent) return;
          if (entry) {
            sendCached(res, entry);
          } else {
            // The originating request failed or disconnected before producing a
            // response. Fail this waiter visibly rather than handing back an
            // empty 200 that the client would read as "no data".
            res.status(503).json({
              success: false,
              message: 'Upstream request failed; retry',
            });
          }
        },
        () => {
          if (!res.headersSent) {
            res.status(503).json({
              success: false,
              message: 'Upstream request failed; retry',
            });
          }
        }
      );
      return undefined;
    }

    let settle;
    let settledFlag = false;
    const pending = new Promise((resolve) => {
      settle = resolve;
    });

    const clear = () => {
      if (inflight.get(key) === pending) inflight.delete(key);
    };

    // Safety net: if the handler never reaches `res.send` (it throws, the error
    // handler responds some other way, or the client disconnects), the in-flight
    // entry would otherwise stay registered forever and every later request for
    // that key would wait on a promise that never settles.
    const abandon = () => {
      if (!settledFlag) {
        settledFlag = true;
        settle(null);
      }
      clear();
    };
    res.on('close', abandon);

    inflight.set(key, pending);

    // Try the cache before touching the handler chain.
    cacheService
      .get(key)
      .then((raw) => {
        if (!raw) return false;

        const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // Release the coalescing slot: the payload is ready.
        if (!settledFlag) {
          settledFlag = true;
          settle(entry);
        }
        clear();
        // And answer the requester from cache.
        sendCached(res, entry);
        return true;
      })
      .catch((error) => {
        // Valkey problem. Fail open: leave the coalescing slot registered so any
        // waiter is released by the handler below, and carry on to the handler.
        logger.warn('responseCache read failed', { error: error.message });
        return false;
      })
      .then((wasHit) => {
        if (wasHit === true) return undefined;

        // Cache miss: capture what the handler sends, then let it run normally.
        //
        // The in-flight entry is deliberately NOT cleared here. It must stay
        // registered until the handler actually responds, otherwise a second
        // request arriving while the handler is still working would find no
        // entry, start a duplicate handler, and defeat coalescing entirely.
        //
        // Only `res.send` is patched. Express's `res.json` sets the JSON
        // Content-Type and then delegates to `this.send(string)`, so patching
        // `res.send` alone catches both paths. Patching `res.json` as well would
        // require calling the original send directly, which skips the
        // Content-Type assignment and makes clients treat the reply as text.
        const originalSend = res.send.bind(res);

        res.send = function patchedSend(body) {
          const contentType = res.getHeader('Content-Type');
          const status = res.statusCode;
          const contentTypeStr =
            typeof contentType === 'string' ? contentType : undefined;

          const isJson =
            typeof body === 'string' &&
            contentTypeStr &&
            contentTypeStr.includes('application/json');

          let cacheable = false;
          if (isJson && status >= 200 && status < 300) {
            try {
              // The backend marks its own responses with success: true; only
              // those are worth replaying later.
              cacheable = JSON.parse(body)?.success === true;
            } catch (_) {
              cacheable = false;
            }
          }

          if (cacheable) {
            store(key, { status, contentType: contentTypeStr, body }, ttl);
          }

          // Release any coalesced waiters with whatever we produced.
          if (!settledFlag) {
            settledFlag = true;
            settle({ status, contentType: contentTypeStr, body });
          }
          clear();

          return originalSend(body);
        };

        return next();
      });

    return undefined;
  };
}

module.exports = responseCache;
module.exports.ttlFor = ttlFor;
module.exports.resolveScope = resolveScope;
module.exports.cacheKey = cacheKey;
module.exports.inflight = inflight;