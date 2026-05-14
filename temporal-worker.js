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
