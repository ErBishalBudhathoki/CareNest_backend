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

let appInstance = null;
let bootstrapPromise = null;
let serverlessHandler = null;

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
      } catch (error) {
        logger.warn('⚠️  Failed to load consolidated secrets, using environment variables', {
          error: error.message
        });
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
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start Schedulers
const startSchedulers = async () => {
  try {
    require('./cron/notificationScheduler').start();
    require('./cron/dunningScheduler').scheduleDunning();
    require('./cron/scheduler').start();
    
    // Legacy schedulers
    try {
      const { startTimesheetReminderScheduler } = require('./timesheet_reminder_scheduler');
      await startTimesheetReminderScheduler();
    } catch (e) { logger.warn('⚠️ Timesheet scheduler issue:', e.message); }

    try {
      const { startExpenseReminderScheduler } = require('./expense_reminder_scheduler');
      require('./expense_reminder_scheduler').startExpenseReminderScheduler();
    } catch (e) { logger.warn('⚠️ Expense scheduler issue:', e.message); }
    
    logger.info('⏰ All schedulers initialized');
  } catch (error) {
    logger.error('Failed to start schedulers', { error: error.message });
  }
};

// Start Workers
const startWorkers = () => {
  try {
    require('./subscribers/ShiftSubscriber');
    const QueueManager = require('./core/QueueManager');
    const processInvoiceJob = require('./workers/InvoiceWorker');
    QueueManager.registerWorker('invoice-generation', processInvoiceJob);
    logger.info('👷 Job Workers & Subscribers initialized');
  } catch (err) {
    logger.error('Failed to initialize workers', { error: err.message });
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
      
      console.log(`⏳ Attempting to bind to port ${PORT}...`);
      app.listen(PORT, '0.0.0.0', async () => {
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

        console.log('⏳ Initializing JWT key rotation...');
        try {
          await keyRotationService.initialize({
            keyLifetimeDays: process.env.JWT_KEY_LIFETIME_DAYS || 90
          });

          if (process.env.JWT_AUTO_ROTATION_ENABLED !== 'false') {
            const rotationInterval = parseInt(process.env.JWT_ROTATION_INTERVAL_DAYS || '30');
            await keyRotationService.startAutomaticRotation(rotationInterval);
            console.log(`✅ JWT key rotation initialized (auto-rotate every ${rotationInterval} days)`);
          } else {
            console.log('✅ JWT key rotation initialized (auto-rotation disabled)');
          }
        } catch (error) {
          logger.error('JWT key rotation initialization failed', { error: error.message });
          logger.warn('⚠️  Falling back to JWT_SECRET from environment');
        }

        console.log('⏳ Starting schedulers...');
        startSchedulers();
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
          if (!environmentConfig.isDevelopmentEnvironment()) {
            const serverUrl = process.env.RENDER_EXTERNAL_URL || 'https://more-than-invoice.onrender.com';
            keepAliveService.initialize(serverUrl);
          }
        } catch (e) {
          logger.warn('Keep-alive initialization skipped', { error: e.message });
        }
      })();

    } catch (error) {
      logger.error('Server startup failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  };

  startServer();

  // Graceful Shutdown
  const shutdown = (signal) => {
    logger.info(`🛑 Received ${signal}, shutting down...`);
    
    // Stop key rotation
    try {
      keyRotationService.stopAutomaticRotation();
      logger.info('✅ JWT key rotation stopped');
    } catch (e) {
      logger.warn('Failed to stop key rotation', { error: e.message });
    }
    
    if (keepAliveService) keepAliveService.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} else {
  // Export app for testing
  module.exports = appInstance || require('./app');
}
