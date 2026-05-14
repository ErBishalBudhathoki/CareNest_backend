require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });
const { Worker, NativeConnection } = require('@temporalio/worker');
const logger = require('./config/logger');
const path = require('path');

// Activities
const { sendPushNotification } = require('./temporal/activities/notifications');
const { sendEmergencyPush } = require('./temporal/activities/emergency');
const { processInvoiceActivity } = require('./temporal/activities/invoice');
const { 
  processRecurringInvoicesActivity, 
  processOverdueRemindersActivity 
} = require('./temporal/activities/cron');

async function run() {
  logger.info('Starting Temporal Worker...', { env: process.env.NODE_ENV });

  // Native connection to Temporal server
  const connection = await NativeConnection.connect({
    address: 'temporal.bishalbudhathoki.com:443',
    tls: true,
  });

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
      processOverdueRemindersActivity
    },
  });

  logger.info('Temporal Worker started successfully.');
  
  await worker.run();
}

run().catch((err) => {
  logger.error('Failed to start Temporal Worker', err);
  console.error('TEMPORAL WORKER CRASH DETAILS:');
  console.error(err);
  if (err.cause) console.error('Cause:', err.cause);
  process.exit(1);
});
