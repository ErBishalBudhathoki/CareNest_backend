/**
 * Per-route request timing, exposed as Prometheus histograms.
 *
 * `middleware/systemHealth.js` only tracks a single global average, which tells
 * you that the service got slower but not which endpoint caused it. These
 * histograms are bucketed by route so a regression can be attributed.
 *
 * Cardinality is the thing that will take Prometheus down, so tracking is
 * deliberately conservative:
 *
 *   - Query strings are dropped entirely (they carry org ids, emails and dates).
 *   - Path segments that look like ids or emails collapse to `:id` / `:email`.
 *   - Only allowlisted prefixes are tracked at all.
 *   - A hard cap on distinct keys; anything past it is aggregated as `other`.
 *
 * Everything is in-process, so counters reset on redeploy and are per-instance.
 * That is correct for latency (a rate-like quantity) but will show gaps in
 * `rate()` for request counts on Cloud Run with more than one replica.
 */

const logger = require('../config/logger');

/** Buckets in milliseconds. Chosen around the thresholds that matter for UX. */
const BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * Only these path prefixes are tracked. Anything else is ignored rather than
 * recorded under `other`, because most of the API is low-traffic CRUD and
 * tracking it adds cost without adding insight.
 */
const TRACKED_PREFIXES = [
  'earnings/',
  'dashboard/',
  'billing/dashboard/',
  'analytics/',
  'financial-intelligence/',
  'workforce/',
  'timesheet/',
  'leave/',
  'invoices/',
  'clients/',
  'assignments/',
  'requests/',
];

const MAX_TRACKED_ROUTES = 200;
const OTHER_KEY = 'other';

const buckets = new Map();

function emptyBucket() {
  return {
    counts: new Array(BUCKETS.length).fill(0),
    sum: 0,
    count: 0,
    statusClasses: new Map(),
  };
}

/**
 * Collapse a concrete request path into a low-cardinality route key.
 *
 * `earnings/summary/ada@carenest.com.au` -> `earnings/summary/:email`
 * `workforce/bi/dashboard` -> `workforce/bi/dashboard`
 */
function normalizeRoute(rawPath) {
  if (!rawPath) return OTHER_KEY;

  // Drop the query string: it is unbounded in practice.
  const withoutQuery = rawPath.split('?')[0];

  const withoutPrefix = withoutQuery.startsWith('/api/')
    ? withoutQuery.slice(5)
    : withoutQuery.replace(/^\//, '');

  if (!TRACKED_PREFIXES.some((prefix) => withoutPrefix.startsWith(prefix))) {
    return null;
  }

  const segments = withoutPrefix.split('/').map((segment) => {
    if (!segment) return segment;
    if (segment.includes('@')) return ':email';
    if (/^[0-9a-fA-F]{24}$/.test(segment)) return ':id';
    if (/^\d+$/.test(segment)) return ':id';
    if (segment.length > 24) return ':id';
    return segment;
  });

  return segments.join('/');
}

function bucketFor(routeKey) {
  let bucket = buckets.get(routeKey);
  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_ROUTES) {
      bucket = buckets.get(OTHER_KEY) || emptyBucket();
      buckets.set(OTHER_KEY, bucket);
    } else {
      bucket = emptyBucket();
      buckets.set(routeKey, bucket);
    }
  }
  return bucket;
}

function statusClass(statusCode) {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return 'other';
}

/**
 * Record one completed request. `res.on('finish')` supplies the status code.
 */
function record(req, durationMs) {
  let routeKey;
  try {
    routeKey = normalizeRoute(req.originalUrl || req.url);
  } catch (_) {
    return;
  }

  if (routeKey === null) return;

  try {
    const bucket = bucketFor(routeKey);
    bucket.count += 1;
    bucket.sum += durationMs;

    for (let i = 0; i < BUCKETS.length; i += 1) {
      if (durationMs <= BUCKETS[i]) {
        bucket.counts[i] += 1;
      }
    }

    const klass = statusClass(req.res ? req.res.statusCode : 0);
    bucket.statusClasses.set(klass, (bucket.statusClasses.get(klass) || 0) + 1);
  } catch (error) {
    // Metrics must never break the request path.
    logger.warn('Failed to record request timing', { error: error.message });
  }
}

/**
 * Express middleware. Attach before the routes so the timer wraps the handler.
 */
function requestTimingMiddleware() {
  return function requestTiming(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      record(req, durationMs);
    });

    next();
  };
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '');
}

function render() {
  let output = '';

  output += '# HELP http_route_duration_seconds Route latency histogram\n';
  output += '# TYPE http_route_duration_seconds histogram\n';

  for (const [routeKey, bucket] of buckets.entries()) {
    const route = escapeLabel(routeKey);
    let cumulative = 0;

    for (let i = 0; i < BUCKETS.length; i += 1) {
      cumulative += bucket.counts[i];
      output +=
        `http_route_duration_seconds_bucket{le="${BUCKETS[i]}",route="${route}"} ${cumulative}\n`;
    }

    output +=
      `http_route_duration_seconds_bucket{le="+Inf",route="${route}"} ${bucket.count}\n`;
    output +=
      `http_route_duration_seconds_sum{route="${route}"} ${(bucket.sum / 1000).toFixed(6)}\n`;
    output += `http_route_duration_seconds_count{route="${route}"} ${bucket.count}\n`;
  }

  output += '# HELP http_route_requests_total Completed requests by route and status class\n';
  output += '# TYPE http_route_requests_total counter\n';

  for (const [routeKey, bucket] of buckets.entries()) {
    const route = escapeLabel(routeKey);
    for (const [klass, value] of bucket.statusClasses.entries()) {
      output +=
        `http_route_requests_total{route="${route}",status="${klass}"} ${value}\n`;
    }
  }

  return output;
}

function reset() {
  buckets.clear();
}

function snapshot() {
  return Array.from(buckets.entries()).map(([route, bucket]) => ({
    route,
    count: bucket.count,
    averageMs: bucket.count > 0 ? Math.round(bucket.sum / bucket.count) : 0,
  }));
}

module.exports = {
  requestTimingMiddleware,
  render,
  record,
  reset,
  snapshot,
  normalizeRoute,
  BUCKETS,
  TRACKED_PREFIXES,
};