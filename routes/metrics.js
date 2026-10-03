/**
 * Prometheus Metrics Endpoints
 *
 * Mounted directly on the app (see app.js), NOT under the `/api` router, because
 * Prometheus cannot satisfy the App Check + bearer gate that `apiSecurityGate`
 * applies to `/api`. That mismatch is why every scrape target was returning 404:
 * this router used to be mounted as `router.use('/', metricsRoutes)` under
 * `/api`, which put the real paths at `/api/metrics` and
 * `/api/api/metrics/*`, while Prometheus asked for `/metrics`.
 *
 * Because the endpoint is now reachable without the App Check gate it requires
 * `METRICS_SCRAPE_TOKEN`. If that is unset the endpoints refuse to serve and the
 * process says so at boot, rather than falling open to a public endpoint that
 * exposes business figures.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { getSystemHealthSnapshot } = require('../middleware/systemHealth');
const requestTiming = require('../utils/requestTiming');
const logger = require('../config/logger');

const SCRAPE_TOKEN = process.env.METRICS_SCRAPE_TOKEN;

/**
 * Rate limit for metrics endpoints. The default in-memory store is per-instance,
 * which is acceptable here: Prometheus scrapes on a fixed interval and a single
 * scraper cannot meaningfully abuse it.
 */
const metricsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, message: 'Too many metrics requests.' },
});

/**
 * Counts below change on the order of hours at most; they are not request-rate
 * metrics and recomputing six full-collection counts on every 15-60s scrape is
 * the single most expensive thing this module used to do.
 */
const BUSINESS_CACHE_TTL_MS = 60 * 1000;
let businessCache = { value: null, storedAt: 0 };

/** Convert metrics to Prometheus format. */
function formatPrometheusMetrics(metrics) {
  let output = '';

  output += `# HELP nodejs_memory_rss_bytes Process resident memory size in bytes\n`;
  output += `# TYPE nodejs_memory_rss_bytes gauge\n`;
  output += `nodejs_memory_rss_bytes ${metrics.memory.rss * 1024 * 1024}\n\n`;

  output += `# HELP nodejs_memory_heap_used_bytes Process heap memory used in bytes\n`;
  output += `# TYPE nodejs_memory_heap_used_bytes gauge\n`;
  output += `nodejs_memory_heap_used_bytes ${metrics.memory.heapUsed * 1024 * 1024}\n\n`;

  output += `# HELP nodejs_memory_heap_total_bytes Process heap memory total in bytes\n`;
  output += `# TYPE nodejs_memory_heap_total_bytes gauge\n`;
  output += `nodejs_memory_heap_total_bytes ${metrics.memory.heapTotal * 1024 * 1024}\n\n`;

  output += `# HELP system_memory_usage_percent System memory usage percentage\n`;
  output += `# TYPE system_memory_usage_percent gauge\n`;
  output += `system_memory_usage_percent ${metrics.system.memoryUsagePercent}\n\n`;

  output += `# HELP system_load_average_1m System load average over 1 minute\n`;
  output += `# TYPE system_load_average_1m gauge\n`;
  output += `system_load_average_1m ${metrics.system.loadAverage1m}\n\n`;

  output += `# HELP system_load_average_5m System load average over 5 minutes\n`;
  output += `# TYPE system_load_average_5m gauge\n`;
  output += `system_load_average_5m ${metrics.system.loadAverage5m}\n\n`;

  output += `# HELP system_load_average_15m System load average over 15 minutes\n`;
  output += `# TYPE system_load_average_15m gauge\n`;
  output += `system_load_average_15m ${metrics.system.loadAverage15m}\n\n`;

  output += `# HELP http_requests_total Total number of HTTP requests\n`;
  output += `# TYPE http_requests_total counter\n`;
  output += `http_requests_total ${metrics.application.totalRequests}\n\n`;

  output += `# HELP http_request_errors_total Total number of HTTP request errors\n`;
  output += `# TYPE http_request_errors_total counter\n`;
  output += `http_request_errors_total ${metrics.application.totalErrors}\n\n`;

  output += `# HELP http_request_duration_ms Average HTTP request duration in milliseconds\n`;
  output += `# TYPE http_request_duration_ms gauge\n`;
  output += `http_request_duration_ms ${metrics.application.averageResponseTime}\n\n`;

  output += `# HELP http_request_error_rate HTTP request error rate percentage\n`;
  output += `# TYPE http_request_error_rate gauge\n`;
  output += `http_request_error_rate ${metrics.application.errorRate}\n\n`;

  output += `# HELP process_uptime_seconds Process uptime in seconds\n`;
  output += `# TYPE process_uptime_seconds gauge\n`;
  output += `process_uptime_seconds ${metrics.application.uptime}\n\n`;

  return output;
}

/**
 * Business counters, read through the existing Mongoose connection.
 *
 * This used to construct a `new MongoClient(...)` and run a TCP+TLS handshake to
 * Mongo on every single scrape, then close it again — on top of six
 * `countDocuments` calls. Reusing `mongoose.connection.db` removes the handshake
 * and the caching removes the counts.
 *
 * Returns `null` rather than throwing when Mongo is unavailable, so a
 * disconnected database degrades to a missing metric instead of a 500 that
 * makes Prometheus mark the whole target down.
 */
async function getBusinessMetrics() {
  if (businessCache.value && Date.now() - businessCache.storedAt < BUSINESS_CACHE_TTL_MS) {
    return businessCache.value;
  }

  const db = mongoose.connection && mongoose.connection.db;
  if (!db) {
    logger.warn('Business metrics unavailable: mongoose connection not established');
    return null;
  }

  try {
    const totalOrganizations = await db.collection('organizations').countDocuments();
    const totalUsers = await db.collection('login').countDocuments();
    const totalClients = await db.collection('clients').countDocuments();
    const totalAssignments = await db.collection('clientAssignments').countDocuments();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const activeAssignments = await db.collection('clientAssignments').countDocuments({
      date: {
        $gte: today.toISOString().split('T')[0],
        $lt: tomorrow.toISOString().split('T')[0],
      },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentInvoices = await db.collection('invoices').countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    const value = {
      totalOrganizations,
      totalUsers,
      totalClients,
      totalAssignments,
      activeAssignments,
      recentInvoices,
    };

    businessCache = { value, storedAt: Date.now() };
    return value;
  } catch (error) {
    logger.warn('Business metrics query failed', { error: error.message });
    return null;
  }
}

/** Format business metrics for Prometheus. */
function formatBusinessMetrics(metrics) {
  if (!metrics) {
    return '# HELP invoice_business_metrics_available Business metrics collection succeeded\n' +
           '# TYPE invoice_business_metrics_available gauge\n' +
           'invoice_business_metrics_available 0\n\n';
  }

  let output = '';

  output += `# HELP invoice_business_metrics_available Business metrics collection succeeded\n`;
  output += `# TYPE invoice_business_metrics_available gauge\n`;
  output += `invoice_business_metrics_available 1\n\n`;

  output += `# HELP invoice_organizations_total Total number of organizations\n`;
  output += `# TYPE invoice_organizations_total gauge\n`;
  output += `invoice_organizations_total ${metrics.totalOrganizations}\n\n`;

  output += `# HELP invoice_users_total Total number of users\n`;
  output += `# TYPE invoice_users_total gauge\n`;
  output += `invoice_users_total ${metrics.totalUsers}\n\n`;

  output += `# HELP invoice_clients_total Total number of clients\n`;
  output += `# TYPE invoice_clients_total gauge\n`;
  output += `invoice_clients_total ${metrics.totalClients}\n\n`;

  output += `# HELP invoice_assignments_total Total number of assignments\n`;
  output += `# TYPE invoice_assignments_total gauge\n`;
  output += `invoice_assignments_total ${metrics.totalAssignments}\n\n`;

  output += `# HELP invoice_assignments_active Active assignments today\n`;
  output += `# TYPE invoice_assignments_active gauge\n`;
  output += `invoice_assignments_active ${metrics.activeAssignments}\n\n`;

  output += `# HELP invoice_invoices_recent Recent invoices (last 30 days)\n`;
  output += `# TYPE invoice_invoices_recent gauge\n`;
  output += `invoice_invoices_recent ${metrics.recentInvoices}\n\n`;

  return output;
}

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * Require the scrape token. Fails closed: with no token configured the endpoint
 * returns 503 and says why, rather than serving business metrics publicly.
 */
function requireScrapeToken(req, res, next) {
  if (!SCRAPE_TOKEN) {
    return res.status(503).type('text/plain').send(
      'Metrics are disabled. Set METRICS_SCRAPE_TOKEN to expose this endpoint.\n'
    );
  }

  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const provided = bearer || req.get('x-scrape-token') || '';

  if (provided !== SCRAPE_TOKEN) {
    logger.security('Metrics scrape rejected', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent'),
    });
    return res.status(401).type('text/plain').send('Unauthorized\n');
  }

  return next();
}

/**
 * GET /metrics — system health + business counters + route latency histograms.
 */
router.get('/', metricsLimiter, requireScrapeToken, async (req, res) => {
  try {
    const systemHealth = getSystemHealthSnapshot();
    const businessMetrics = await getBusinessMetrics();

    let output = '';
    output += formatPrometheusMetrics(systemHealth);
    output += formatBusinessMetrics(businessMetrics);
    output += requestTiming.render();

    res.set('Content-Type', PROMETHEUS_CONTENT_TYPE);
    res.send(output);
  } catch (error) {
    logger.error('Error generating metrics', { error: error.message });
    res.status(500).send('Error generating metrics');
  }
});

/** GET /metrics/system */
router.get('/system', metricsLimiter, requireScrapeToken, (req, res) => {
  try {
    const output = formatPrometheusMetrics(getSystemHealthSnapshot());
    res.set('Content-Type', PROMETHEUS_CONTENT_TYPE);
    res.send(output);
  } catch (error) {
    logger.error('Error generating system metrics', { error: error.message });
    res.status(500).send('Error generating system metrics');
  }
});

/** GET /metrics/business */
router.get('/business', metricsLimiter, requireScrapeToken, async (req, res) => {
  try {
    const businessMetrics = await getBusinessMetrics();
    const output = formatBusinessMetrics(businessMetrics);
    res.set('Content-Type', PROMETHEUS_CONTENT_TYPE);
    res.send(output);
  } catch (error) {
    logger.error('Error generating business metrics', { error: error.message });
    res.status(500).send('Error generating business metrics');
  }
});

module.exports = router;