/**
 * Server Entry Point
 * Handles database connection, scheduler initialization, and server startup.
 * 
 * @file backend/server.js
 */

const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '.env') });

// Load secrets from Google Cloud Secret Manager or local secrets.json
const { loadSecrets } = require('./config/secretLoader');

const serverless = require("serverless-http");
const fs = require("fs");
const { environmentConfig } = require('./config/environment');
const connectMongoose = require('./config/mongoose');
const logger = require('./config/logger');
const { keepAliveService } = require('./utils/keepAlive');
const keyRotationService = require('./services/jwtKeyRotationService');
const ndisCatalogSyncService = require('./services/ndisCatalogSyncService');

let appInstance = null;
let bootstrapPromise = null;
let serverlessHandler = null;
// The bound HTTP server, captured so shutdown can drain before exiting.
let httpServer = null;

const initializeApplication = async () => {
  if (appInstance) {
    return appInstance;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      console.log('⏳ Loading secrets...');
      try {
        await loadSecrets();
        console.log('✅ Secrets loaded successfully');
        require('./config/redis').refreshConfiguration(true);
      } catch (error) {
        logger.warn('⚠️  Failed to load consolidated secrets, using environment variables', {
          error: error.message
        });
        require('./config/redis').refreshConfiguration(true);
      }

      appInstance = require('./app');
      return appInstance;
    })();
  }

  return bootstrapPromise;
};

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Disabled process.exit(1) to prevent aggressive crashing from non-fatal timeout errors (like Redis)
});

process.on('uncaughtException', (error) => {
  // An uncaught exception leaves the process in an unknown state. Continuing to
  // serve traffic on top of that risks returning corrupt data, so log and exit
  // non-zero and let the platform restart the instance. This handler used to be
  // empty, which meant a corrupted instance stayed alive and kept serving.
  console.error('Uncaught Exception:', error);
  logger.error('Uncaught exception, exiting', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Schedulers have been migrated to Temporal. See temporal-worker.js and temporal/activities/system_cron.js

// Start Workers
const startWorkers = () => {
  try {
    // Event subscribers (now using Temporal internally)
    require('./subscribers/ShiftSubscriber');
    
    logger.info('👷 Subscribers initialized');
  } catch (err) {
    logger.error('Failed to initialize subscribers', { error: err.message });
  }
};

// Export for Serverless
if (process.env.SERVERLESS === 'true') {
  module.exports.handler = async (event, context) => {
    if (!serverlessHandler) {
      const app = await initializeApplication();
      await connectMongoose(); // Ensure DB connection in lambda
      serverlessHandler = serverless(app);
    }

    return serverlessHandler(event, context);
  };
} 
// Local Server Startup
else if (require.main === module) {
  const PORT = process.env.PORT || 8080;

  const startServer = async () => {
    try {
      console.log('🏁 Starting server initialization...');

      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        logger.info(`📁 Created uploads directory: ${uploadsDir}`);
      }

      const app = await initializeApplication();

      // Emit the resolved Redis/Valkey posture once per boot. This is the line
      // to grep in Cloud Run logs to confirm caching and shared rate limits are
      // actually live — booleans and an enum only, no host or credentials.
      try {
        require('./config/redis').logRedisStatus('server-boot');
      } catch (redisStatusError) {
        logger.warn('Failed to report Redis status at boot', {
          error: redisStatusError.message
        });
      }

      // Prove the Valkey path end-to-end at boot. A silently-degraded cache
      // (disabled config, TLS mismatch, unreachable host) must show up in the
      // logs here rather than as unexplained slow reads later.
      try {
        const started = Date.now();
        // Hard cap: a hanging Valkey must never stall server boot. The shared
        // store degrades on its own; this is a loud-but-fast probe.
        const pong = await Promise.race([
          require('./config/redis').ping(),
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        logger.info('Valkey boot check', { pong: Boolean(pong), latencyMs: Date.now() - started });
        if (!pong) logger.error('Valkey boot check returned no PONG — cache/rate limits degraded');
      } catch (pingError) {
        logger.error('Valkey boot check FAILED — cache and shared rate limits are degraded', {
          error: pingError.message
        });
      }

      console.log(`⏳ Attempting to bind to port ${PORT}...`);
      // Keep the handle so shutdown can drain in-flight requests. It used to be
      // discarded, which made a graceful stop impossible.
      httpServer = app.listen(PORT, '0.0.0.0', async () => {
        console.log('✅ Server bound to port');
        logger.info(`🚀 ${environmentConfig.getConfig().app.name} running on port ${PORT}`);
        logger.info(`🌍 Environment: ${environmentConfig.getEnvironment()}`);
        console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
      });

      (async () => {
        const maxDelayMs = 30000;
        let attempt = 0;

        while (true) {
          try {
            attempt += 1;
            console.log('⏳ Connecting to MongoDB...');
            await connectMongoose();
            console.log('✅ MongoDB Connected');
            break;
          } catch (error) {
            const delayMs = Math.min(maxDelayMs, 1000 * Math.pow(2, attempt));
            logger.error('MongoDB connection failed; retrying', {
              attempt,
              delayMs,
              error: error.message
            });
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }

        console.log('⏳ Syncing NDIS catalog into MongoDB...');
        try {
          const ndisSyncResult = await ndisCatalogSyncService.syncIfChanged({
            reason: 'startup_bootstrap',
          });
          console.log(
            ndisSyncResult.skipped
              ? '✅ NDIS catalog already up to date in MongoDB'
              : '✅ NDIS catalog synced to MongoDB',
          );
        } catch (error) {
          logger.warn('NDIS catalog bootstrap sync failed', {
            error: error.message,
          });
        }

        console.log('⏳ Initializing JWT key rotation...');
        try {
          await keyRotationService.initialize({
            keyLifetimeDays: process.env.JWT_KEY_LIFETIME_DAYS || 90
          });

          if (process.env.JWT_AUTO_ROTATION_ENABLED !== 'false') {
            const configuredInterval = process.env.JWT_ROTATION_INTERVAL_DAYS || '30';
            const rotationConfig = await keyRotationService.startAutomaticRotation(configuredInterval);
            const activeIntervalDays = rotationConfig?.intervalDays || configuredInterval;
            console.log(`✅ JWT key rotation initialized (auto-rotate every ${activeIntervalDays} days)`);
          } else {
            console.log('✅ JWT key rotation initialized (auto-rotation disabled)');
          }
        } catch (error) {
          logger.error('JWT key rotation initialization failed', { error: error.message });
          logger.warn('⚠️  Falling back to JWT_SECRET from environment');
        }

        console.log('✅ Cron schedulers migrated to Temporal');
        console.log('⏳ Starting workers...');
        startWorkers();
        console.log('✅ Background tasks initialized');

        try {
          const { messaging } = require('./firebase-admin-config');
          await messaging.send({ token: 'dummy-token', data: { type: 'startup_check' } }, true)
            .catch(() => logger.info('Firebase Messaging verified'));
        } catch (e) {
          logger.warn('Firebase messaging verification skipped', { error: e.message });
        }

        try {
          if (environmentConfig.getConfig().features.enableKeepAlive) {
            const serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL;
            keepAliveService.initialize(serverUrl);
          }
        } catch (e) {
          logger.warn('Keep-alive initialization skipped', { error: e.message });
        }
      })();

    } catch (error) {
      logger.error('Server startup failed', { error: error.message, stack: error.stack });
      
    }
  };

  startServer();

  // Graceful Shutdown
  //
  // Cloud Run sends SIGTERM and then allows roughly 10 seconds before SIGKILL.
  // Without draining, every rolling deploy drops the requests that were in
  // flight at that moment — on an API where clients retry dashboard loads, that
  // shows up as a spike of errors on each release.
  const SHUTDOWN_DRAIN_MS = 8000;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`🛑 Received ${signal}, shutting down...`);

    // Stop key rotation
    try {
      keyRotationService.stopAutomaticRotation();
      logger.info('✅ JWT key rotation stopped');
    } catch (e) {
      logger.warn('Failed to stop key rotation', { error: e.message });
    }

    if (keepAliveService) keepAliveService.stop();

    const exit = () => process.exit(0);

    if (!httpServer) {
      exit();
      return;
    }

    // Stop accepting new connections, let existing requests finish.
    logger.info('Draining in-flight requests...');
    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      logger.warn('Drain timed out, forcing exit');
      exit();
    }, SHUTDOWN_DRAIN_MS);
    // Do not hold the event loop open purely for the drain timer.
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    httpServer.close(() => {
      if (forced) return;
      clearTimeout(forceTimer);
      logger.info('✅ In-flight requests drained');
      exit();
    });
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} else {
  // Export app for testing
  module.exports = appInstance || require('./app');
}
