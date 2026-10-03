/**
 * Express Application Configuration
 * Handles middleware setup, security, routes, and error handling.
 * 
 * @file backend/app.js
 */

const express = require("express");
const path = require('path');

// Load .env before anything reads process.env.
//
// server.js also does this, but app.js is required directly by tests and by any
// consumer that does not boot through server.js. Previously the only thing
// loading .env for those callers was a stray `dotenv.config()` inside
// routes/metrics.js — so .env visibility depended on route import order, and
// removing that line silently unset GCP_PROJECT_ID and friends. Load it here so
// it is deterministic.
//
// dotenv never overwrites variables that are already set, so on Cloud Run (where
// env comes from the platform and Secret Manager) this is a no-op: the image has
// no .env file.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const rateLimit = require("express-rate-limit");
const { environmentConfig } = require('./config/environment');
const redisConfig = require('./config/redis');
const mongoose = require('mongoose');

// Import Middleware
const { loggingMiddleware } = require('./middleware/logging');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { errorTrackingMiddleware } = require('./middleware/errorTracking');
const { systemHealthMiddleware } = require('./middleware/systemHealth');
const { requestLogger, securityLogger } = require('./middleware/requestLogger');
const { apiSecurityGate } = require('./middleware/apiSecurityGate');
const { subscriptionGate } = require('./middleware/billing/subscriptionGate');
const responseCache = require('./middleware/responseCache');
const { withSharedStore } = require('./middleware/rateLimitStore');
const { apiUsageMonitor } = require('./utils/apiUsageMonitor');
const { requestTimingMiddleware } = require('./utils/requestTiming');
const { renderClientSetPasswordPage } = require('./utils/clientSetPasswordPage');

// Initialize express app
const app = express();

// Trust Proxy (Required for Cloud Run / Load Balancer)
//
// `req.ip` is what every IP-keyed rate limiter and the brute-force tracker uses,
// so this value has to match the real number of proxies in front of the app.
//
// On Cloud Run there is exactly one hop (the Google Front End), which is why 1
// is correct. Setting it to `true` would let any client spoof X-Forwarded-For
// and bypass those limits entirely, so it is deliberately a number.
//
// Override with TRUST_PROXY_HOPS if a CDN or Cloudflare Tunnel is added in front,
// and increment the value for each additional hop.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
app.set('trust proxy', Number.isNaN(trustProxyHops) ? 1 : trustProxyHops);

// Security middleware - must be first
app.use(helmet({
  // Explicit HSTS: force HTTPS for 1 year, all subdomains, preload-ready.
  // (TLS itself is terminated at the Cloud Run / Render edge; this header
  // tells compliant clients to never attempt plaintext HTTP.)
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.redoc.ly"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "https://cdn.redoc.ly"],
      connectSrc: ["'self'", "https://identitytoolkit.googleapis.com"],
      fontSrc: ["'self'", "https:", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      workerSrc: ["'self'", "blob:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Reject plaintext HTTP in production (no-op locally; health probes exempt).
// Must run before CORS/routes so insecure requests fail fast.
app.use(require('./middleware/requireHttps').requireHttps);

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = environmentConfig.getConfig().security.corsOrigins || [];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow localhost origins explicitly defined in config
    // NEVER allow all origins even in development for security
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Log rejected CORS attempts for security monitoring
      const { createLogger } = require('./utils/logger');
      const logger = createLogger('CORS');
      logger.security('CORS request blocked', { 
        origin, 
        allowed: allowedOrigins,
        environment: process.env.NODE_ENV 
      });
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Firebase-AppCheck', 'X-Platform', 'x-correlation-id'],
  credentials: true,
  maxAge: 86400 // 24 hours - cache preflight requests
};

app.use(cors(corsOptions));

// Webhook routes (Must be before express.json() to capture raw body)
app.use('/webhooks', require('./routes/webhookRoutes'));
// Public browser callbacks for Stripe Connect OAuth. Must remain public
// because the user is redirected from Stripe's site and has no App Check.
app.use('/public/connect/oauth', require('./routes/billing/connectPublicRoutes'));

// Body parsing
app.use(express.json({
  limit: process.env.REQUEST_BODY_LIMIT || '25mb',
  verify: (req, res, buf, encoding) => {
    // Skip parsing for multipart/form-data - let Multer handle it
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      throw new Error('Multipart data should not be parsed by express.json()');
    }
  }
}));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.REQUEST_BODY_LIMIT || '25mb',
  verify: (req, res, buf, encoding) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      throw new Error('Multipart data should not be parsed by express.urlencoded()');
    }
  }
}));

// Sanitize data against NoSQL query injection
app.use(mongoSanitize());

// Response compression.
//
// Analytics and dashboard payloads are large JSON and were previously sent
// uncompressed. Images, video and PDFs are already compressed formats — running
// them through gzip burns CPU for a negligible size win, and this app serves
// organisation logos, receipts and generated invoices from /uploads.
//
// Registered before the logging middlewares so the recorded response size is the
// compressed size on the wire.
const COMPRESSION_LEVEL = Number(process.env.COMPRESSION_LEVEL || 6);
app.use(
  compression({
    level: COMPRESSION_LEVEL,
    threshold: 1024, // don't bother with tiny responses
    filter: (req, res) => {
      const type = res.getHeader('Content-Type');
      if (typeof type === 'string') {
        if (/^(image\/|video\/|audio\/)/i.test(type)) return false;
        if (/^application\/(pdf|zip|gzip|x-tar|octet-stream)/i.test(type)) return false;
      }
      return compression.filter(req, res);
    },
  })
);

// Global Middleware
app.use(systemHealthMiddleware);
// Per-route latency histograms, exported at /metrics. Registered early so the
// timer wraps route handlers, and cheap: it only records allowlisted prefixes.
app.use(requestTimingMiddleware());
app.use(loggingMiddleware); // Legacy logger
app.use(requestLogger); // New structured request logger
app.use(securityLogger); // Security event logger
app.use(errorTrackingMiddleware);
app.use(apiUsageMonitor.middleware);

// API Documentation (Swagger & Redoc)
app.use('/', require('./config/swagger'));

// DEV ONLY: Reset rate limits and IP blocks (no auth required)
// This endpoint is only available in development environment
// Placed BEFORE main routes to avoid auth middleware
app.post('/dev/reset-rate-limits', (req, res) => {
  // Only allow in development
  if (!environmentConfig.isDevelopmentEnvironment()) {
    return res.status(403).json({
      success: false,
      message: 'This endpoint is only available in development environment'
    });
  }

  try {
    const { AuthMiddleware } = require('./middleware/auth');

    // Clear blocked IPs
    if (AuthMiddleware.blockedIPs) {
      const blockedCount = AuthMiddleware.blockedIPs.size;
      AuthMiddleware.blockedIPs.clear();
      console.log(`[DEV] Cleared ${blockedCount} blocked IPs`);
    }

    // Clear failed attempts
    if (AuthMiddleware.failedAttempts) {
      const attemptsCount = AuthMiddleware.failedAttempts.size;
      AuthMiddleware.failedAttempts.clear();
      console.log(`[DEV] Cleared ${attemptsCount} failed attempt records`);
    }

    res.json({
      success: true,
      message: 'Rate limits and IP blocks cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[DEV] Error resetting rate limits:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting rate limits',
      error: error.message
    });
  }
});

// Health check endpoint (placed before main routes to ensure access)
//
// Liveness only: dependency state is reported but deliberately does NOT affect
// the 200. Valkey lives on a remote host and the cache is not authoritative, so
// a brief Valkey outage must not make the platform kill otherwise-healthy
// instances. Hard dependency gating belongs in the readiness probe instead.
app.get('/health', (req, res) => {
  // A diagnostic endpoint must never itself throw. Report dependencies as
  // 'unknown' rather than 500-ing if introspection fails.
  let redisMode = 'unknown';
  let mongoMode = 'unknown';
  try {
    redisMode = redisConfig.assertRedisConfigured().mode;
  } catch (error) {
    // app.js has no module-level logger; match the existing console usage here.
    console.error('[health] Redis status introspection failed:', error.message);
  }
  try {
    mongoMode = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  } catch (error) {
    console.error('[health] Mongo status introspection failed:', error.message);
  }

  res.status(200).json({
    status: 'OK',
    service: environmentConfig.getConfig().app.name,
    timestamp: new Date().toISOString(),
    environment: environmentConfig.getEnvironment(),
    dependencies: {
      // Modes only — never the host, URL, or port. This endpoint is public.
      redis: redisMode,
      mongo: mongoMode
    }
  });
});

// API health endpoint (for compatibility with deployment checks)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: environmentConfig.getConfig().app.name,
    timestamp: new Date().toISOString(),
    environment: environmentConfig.getEnvironment(),
    api: 'available'
  });
});

// Client activation web reset page (public)
app.get('/client/set-password', (req, res) => {
  const firebaseWebApiKey =
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    '';

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).type('html').send(
    renderClientSetPasswordPage({
      apiKey: firebaseWebApiKey,
      brandName: 'CareNest'
    })
  );
});

// Main API Routes
// Security model:
// - Public bootstrap/auth flows are explicitly bypassed inside apiSecurityGate.
// - Protected /api routes require App Check first, then bearer auth.
// - /api/scheduler bypasses this gate because it already uses Cloud Scheduler OIDC auth.
// - Future server-to-server callers should use an explicit bypass or gateway path,
//   not weaken the default mobile-oriented gate.

// Global Rate Limiter for API Routes (prevents DDoS and brute force)
//
// Backed by Valkey so the limit is enforced across every Cloud Run instance.
// With the default in-memory store and maxScale 10 the effective ceiling was 10x
// the configured value, and every counter reset whenever an instance recycled.
const apiLimiter = rateLimit(
  withSharedStore(
    {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Limit each IP to 1000 requests per windowMs
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        message: 'Too many requests from this IP, please try again after 15 minutes'
      }
    },
    'rl:api:'
  )
);

app.use('/api', apiLimiter);

// Dev-only admin tooling.
//
// It sits outside both the /api limiter and the App Check gate, so it carries
// its own basic auth (see routes/adminDevRoutes.js, which additionally refuses
// to authenticate when ADMIN_DEV_PASSWORD is unset). Belt and braces: do not
// mount it in production unless someone has deliberately opted in, because
// "basic auth left on in prod" is the kind of thing that survives for years.
if (environmentConfig.isProductionEnvironment() && process.env.ENABLE_ADMIN_DEV !== 'true') {
  logger.warn?.(
    'Skipping /admin-dev mount in production (set ENABLE_ADMIN_DEV=true to allow it)'
  );
} else {
  app.use('/admin-dev', require('./routes/adminDevRoutes'));
}

// Prometheus scrape endpoint.
//
// Mounted here, before `apiSecurityGate`, because that gate requires a Firebase
// App Check token plus a bearer token and Prometheus has neither. It therefore
// carries its own auth: `requireScrapeToken` inside the router, which fails
// closed with a 503 when METRICS_SCRAPE_TOKEN is unset.
//
// The route defines '/', '/system' and '/business', which resolve to
// /metrics, /metrics/system and /metrics/business.
app.use('/metrics', require('./routes/metrics'));

// The scrape endpoint fails closed without a token. Say so at boot rather than
// leaving Prometheus to silently 503 on every scrape.
if (!process.env.METRICS_SCRAPE_TOKEN) {
  console.error(
    '[metrics] METRICS_SCRAPE_TOKEN is not set — /metrics, /metrics/system and ' +
      '/metrics/business will return 503. Set it in the environment to enable ' +
      'Prometheus scraping.'
  );
}

// Order matters here:
//   apiSecurityGate      populates req.user — the cache key includes it, and
//                        caching without an authenticated identity is unsafe.
//   subscriptionGate     runs first so a paywalled response is never cached and
//                        later replayed to a client whose entitlement changed.
//   responseCache        read-through cache for heavy dashboard/analytics GETs.
//   routes               the actual handlers.
//
// The cache only acts on an explicit allowlist of read-only prefixes and skips
// caching whenever the organisation cannot be resolved, so it can never serve
// one tenant's figures to another.
app.use(
  '/api',
  apiSecurityGate,
  subscriptionGate,
  responseCache(),
  require('./routes')
);

// Serve static files from uploads directory
// Organization logos are public branding; everything else (receipts,
// certifications, profile photos, IDs) requires authentication because
// local filenames are predictable and must not be anonymously enumerable.
app.use('/uploads/logos', express.static(path.join(__dirname, 'uploads/logos')));
app.use(
  '/uploads',
  require('./middleware/auth').authenticateUser,
  express.static(path.join(__dirname, 'uploads'))
);





// Error handling middleware - must be added after all routes
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
