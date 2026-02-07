/**
 * Server Entry Point
 * Handles database connection, scheduler initialization, and server startup.
 * 
 * @file backend/server.js
 */

const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '.env') });

const serverless = require("serverless-http");
const fs = require("fs");
const { environmentConfig } = require('./config/environment');
const connectMongoose = require('./config/mongoose');
const logger = require('./config/logger');
const { messaging } = require('./firebase-admin-config');
const { keepAliveService } = require('./utils/keepAlive');
const app = require('./app');

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
  connectMongoose(); // Ensure DB connection in lambda
  module.exports.handler = serverless(app);
} 
// Local Server Startup
else if (require.main === module) {
  const PORT = process.env.PORT || 8080;

  const startServer = async () => {
    try {
      console.log('🏁 Starting server initialization...');
      // 1. Connect to Database
      console.log('⏳ Connecting to MongoDB...');
      await connectMongoose();
      console.log('✅ MongoDB Connected');
      
      // 2. Initialize Background Tasks
      console.log('⏳ Starting schedulers...');
      startSchedulers();
      console.log('⏳ Starting workers...');
      startWorkers();
      console.log('✅ Background tasks initialized');

      // 3. Ensure Uploads Directory
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        logger.info(`📁 Created uploads directory: ${uploadsDir}`);
      }

      // 4. Start Listening
      console.log(`⏳ Attempting to bind to port ${PORT}...`);
      app.listen(PORT, '0.0.0.0', async () => {
        console.log('✅ Server bound to port');
        logger.info(`🚀 ${environmentConfig.getConfig().app.name} running on port ${PORT}`);
        logger.info(`🌍 Environment: ${environmentConfig.getEnvironment()}`);
        console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);

        // 5. Post-Startup Checks
        try {
          await messaging.send({ token: 'dummy-token', data: { type: 'startup_check' } }, true)
            .catch(() => logger.info('Firebase Messaging verified'));
          
          if (!environmentConfig.isDevelopmentEnvironment()) {
            const serverUrl = process.env.RENDER_EXTERNAL_URL || 'https://more-than-invoice.onrender.com';
            keepAliveService.initialize(serverUrl);
          }
        } catch (e) {
          logger.warn('Startup verification warning', { error: e.message });
        }
      });

    } catch (error) {
      logger.error('Server startup failed', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  };

  startServer();

  // Graceful Shutdown
  const shutdown = (signal) => {
    logger.info(`🛑 Received ${signal}, shutting down...`);
    if (keepAliveService) keepAliveService.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} else {
  // Export app for testing
  module.exports = app;
}
