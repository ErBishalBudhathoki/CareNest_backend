/**
 * Shared rate-limit store backed by Redis/Valkey.
 *
 * Why this exists
 * ---------------
 * `express-rate-limit` defaults to an in-process MemoryStore. On Cloud Run that
 * store is per-instance, so with `maxScale: 10` a limit configured at 100
 * requests per 15 minutes is effectively 1000, and every counter resets
 * whenever an instance is recycled. For auth endpoints, where the limit is the
 * brute-force defence, that gap is the whole point of the control.
 *
 * `middleware/auth.js` already wires a RedisStore for auth routes. This module
 * generalises that so the global API limiter and the dashboard/analytics/
 * earnings limiters can share the same real enforcement.
 *
 * Failure policy: `passOnStoreError` is on everywhere. If Valkey is unreachable
 * the limiter degrades to not counting rather than returning 503 or 500 to every
 * caller — an unavailable cache must never take the API down with it.
 */

// rate-limit-redis v4 exports a named `RedisStore`. The module object itself is
// not constructable — `new RedisStore(...)` on the default import throws
// "RedisStore is not a constructor". middleware/auth.js gets this right; keep
// the two in step.
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');
const logger = require('../config/logger');

/**
 * Build a Valkey-backed store, or return null when Redis is unavailable or the
 * environment is the test suite.
 *
 * Returns null rather than throwing so callers can fall back to the default
 * in-memory store.
 */
function createRateLimitStore(prefix) {
  if (process.env.NODE_ENV === 'test') return null;
  if (redis.isConfigured === false) return null;

  try {
    return new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix,
    });
  } catch (error) {
    logger.warn('Failed to create Redis rate-limit store; falling back to memory', {
      prefix,
      error: error.message,
    });
    return null;
  }
}

/**
 * Apply a Valkey-backed store to an express-rate-limit options object.
 *
 * Mutates and returns `options` so it can be dropped into an existing
 * rateLimit({...}) call without restructuring it.
 */
function withSharedStore(options, prefix) {
  const store = createRateLimitStore(prefix);
  if (!store) return options;

  return {
    ...options,
    store,
    // Never let a cache outage become an API outage.
    passOnStoreError: true,
  };
}

module.exports = {
  createRateLimitStore,
  withSharedStore,
};