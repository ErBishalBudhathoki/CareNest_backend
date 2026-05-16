require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });
const { Worker, NativeConnection } = require('@temporalio/worker');
const mongoose = require('mongoose');
const logger = require('./config/logger');
const path = require('path');

// Activities
const { registerSchedules } = require('./scripts/register-temporal-schedules');
const { sendPushNotification } = require('./temporal/activities/notifications');
const { sendEmergencyPush } = require('./temporal/activities/emergency');
const { processInvoiceActivity } = require('./temporal/activities/invoice');
const { 
  processRecurringInvoicesActivity, 
  processOverdueRemindersActivity 
} = require('./temporal/activities/cron');
const {
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity,
  cleanupArtifactRegistryActivity
} = require('./temporal/activities/system_cron');
const {
  generateAndSendVerificationEmail,
  sendVerificationReminderEmail,
  sendOnboardingReminderEmail,
  activateUserAccount,
} = require('./temporal/activities/employeeOnboardingActivities');

async function run() {
  logger.info('Starting Temporal Worker...', { env: process.env.NODE_ENV });

  // Auto-register schedules if requested
  if (process.env.REGISTER_TEMPORAL_SCHEDULES === 'true') {
    try {
      await registerSchedules();
      logger.info('Temporal schedules registered/synced successfully on worker startup');
    } catch (err) {
      logger.error('Failed to auto-register Temporal schedules on worker startup', err);
      // We don't exit here because the worker can still process activities/workflows
    }
  }

  // Connect to MongoDB — required by activities that query FcmToken, User, etc.
  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || 'Invoice';
  if (mongoUri) {
    await mongoose.connect(mongoUri, { dbName });
    logger.info(`Connected to MongoDB (db=${dbName})`);
  } else {
    logger.warn('MONGODB_URI not set — database-dependent activities will fail');
  }

  // Native connection to Temporal server
  const address = process.env.TEMPORAL_ADDRESS || 'temporal.bishalbudhathoki.com:443';
  const useTls = process.env.TEMPORAL_TLS !== 'false';

  const [host, port] = address.split(':');
  
  // Force IPv4 resolution for the hostname to bypass Oracle Docker IPv6 issues
  const dns = require('dns').promises;
  let finalAddress = address;
  try {
    const lookup = await dns.lookup(host, { family: 4 });
    finalAddress = `${lookup.address}:${port || '443'}`;
  } catch (e) {
    logger.warn(`Failed to resolve IPv4 for ${host}, falling back to original address`, e);
  }

  const connectionOptions = { address: finalAddress };

  if (useTls) {
    connectionOptions.tls = {
      serverNameOverride: host
    };
  }

  const connection = await NativeConnection.connect(connectionOptions);

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'default',
    // Path to the workflows bundle/file
    workflowsPath: path.join(__dirname, 'temporal', 'workflows', 'index.js'),
    activities: {
      sendPushNotification,
      sendEmergencyPush,
      processInvoiceActivity,
      processRecurringInvoicesActivity,
      processOverdueRemindersActivity,
      processDunningActivity,
      processExpenseRemindersActivity,
      processTimesheetRemindersActivity,
      processShiftRemindersActivity,
      processEmailVerificationRemindersActivity,
      cleanupArtifactRegistryActivity,
      // Employee Onboarding
      generateAndSendVerificationEmail,
      sendVerificationReminderEmail,
      sendOnboardingReminderEmail,
      activateUserAccount,
    },
  });

  logger.info('Temporal Worker started successfully.');

  // Start a simple HTTP health check server for Dokploy/Swarm
  const http = require('http');
  const healthPort = process.env.PORT || 8080;
  http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200);
      res.end('Worker is healthy');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }).listen(healthPort, () => {
    logger.info(`Health check server listening on port ${healthPort}`);
  });
  
  await worker.run();
}

run().catch((err) => {
  logger.error('Failed to start Temporal Worker', err);
  console.error('TEMPORAL WORKER CRASH DETAILS:');
  console.error(err);
  if (err.cause) console.error('Cause:', err.cause);
  process.exit(1);
});
