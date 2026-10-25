require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });
const { Worker, NativeConnection } = require('@temporalio/worker');
const mongoose = require('mongoose');
const logger = require('./config/logger');
const path = require('path');

// Activities
const { registerSchedules } = require('./scripts/register-temporal-schedules');
const { sendPushNotification } = require('./temporal/activities/notifications');
const { sendEmergencyPush } = require('./temporal/activities/emergency');
const {
  processInvoiceActivity,
  sendInvoiceEmailActivity,
} = require('./temporal/activities/invoice');
const { leaveApprovalEscalationStepActivity } = require('./temporal/activities/leave');
const { 
  processRecurringInvoicesActivity, 
  processOverdueRemindersActivity,
  processRecurringExpensesActivity,
} = require('./temporal/activities/cron');
const {
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity,
  cleanupArtifactRegistryActivity,
  processInvoiceAIActivity,
  processTrainingExpiryRemindersActivity,
  processHolidayBalanceAccrualActivity
} = require('./temporal/activities/system_cron');
const {
  generateAndSendVerificationEmail,
  sendVerificationReminderEmail,
  sendOnboardingReminderEmail,
  activateUserAccount,
} = require('./temporal/activities/employeeOnboardingActivities');
const {
  sendVerificationEmailActivity,
  sendPasswordResetEmailActivity,
  sendPasswordChangeNotificationActivity,
  sendGenericEmailActivity
} = require('./temporal/activities/auth');
const { generateBulkInvoicesActivity } = require('./temporal/activities/bulk');
const {
  upsertWorkedTimeActivity,
  voidShiftArtifactsActivity,
} = require('./temporal/activities/shift');
const {
  jwtRotationCheckActivity,
  ndisCatalogSyncActivity,
} = require('./temporal/activities/maintenance');

/** Effective connection target, recorded just before NativeConnection.connect. */
let connectionTarget = null;

/**
 * Opens a TLS handshake to host:port and reports whether a TLS server answered.
 * Only used to explain a failed worker startup, so it never blocks startup.
 */
function probeTls(host, port, timeoutMs = 5000) {
  const tls = require('tls');
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = tls.connect(
      {
        host,
        port: Number(port),
        servername: /^[\d.]+$/.test(host) ? undefined : host,
        rejectUnauthorized: false, // we only care whether a TLS server answers
        timeout: timeoutMs,
      },
      () => {
        const result = { ok: true, protocol: socket.getProtocol() };
        socket.destroy();
        done(result);
      },
    );

    socket.on('timeout', () => {
      socket.destroy();
      done({ ok: false, error: 'TIMEOUT' });
    });
    socket.on('error', (err) => done({ ok: false, error: err.code || err.message }));
  });
}

/**
 * A plaintext-versus-TLS mismatch against a proxy shows up as an opaque h2 error
 * (`h2 protocol error: http2 error`, `GoAway(FRAME_SIZE_ERROR)`). Probe the
 * endpoint and name the mismatch so a crash is actionable from the log alone.
 */
async function reportEndpointDiagnosis(err) {
  if (!connectionTarget) return;

  const { configured, address, host, port, tls } = connectionTarget;
  const lines = [
    '',
    'TEMPORAL ENDPOINT DIAGNOSIS',
    `  configured address: ${configured}`,
    `  resolved target:    ${address}`,
    `  worker mode:        ${tls ? 'TLS' : 'plaintext h2c'}`,
  ];

  const probe = await probeTls(host, port);
  lines.push(
    `  TLS handshake:      ${probe.ok ? `OK (${probe.protocol})` : `failed (${probe.error})`}`,
  );

  if (probe.ok && !tls) {
    lines.push(
      '  MISMATCH: the endpoint speaks TLS but the worker connected in plaintext.',
      '  Fix: set TEMPORAL_TLS=true (plus TEMPORAL_TLS_SERVER_NAME and the CA/client',
      '  cert paths if the gateway requires mTLS), or point TEMPORAL_ADDRESS at the',
      '  plaintext gRPC port.',
    );
  } else if (!probe.ok && tls) {
    lines.push(
      '  MISMATCH: the endpoint does not accept TLS but the worker connected with TLS.',
      '  Fix: set TEMPORAL_TLS=false for the plaintext on-host gRPC endpoint.',
    );
  } else if (probe.ok && tls) {
    lines.push(
      '  TLS matches. The failure is after the handshake: check the client cert/CA',
      '  (mTLS) and that TEMPORAL_TLS_SERVER_NAME matches the certificate SAN.',
    );
  }

  if (/FRAME_SIZE_ERROR/i.test(String(err && err.message))) {
    lines.push(
      '  h2 GOAWAY with FRAME_SIZE_ERROR means the TCP peer is speaking a different',
      '  protocol than the worker — almost always a TLS/plaintext mismatch, or a port',
      '  that is not the Temporal frontend.',
    );
  }

  console.error(lines.join('\n'));
  logger.error(lines.slice(1).join(' | '));
}

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

  logger.info(`Connecting to Temporal worker endpoint ${finalAddress} (configured=${address}, tls=${useTls})`);

  const fs = require('fs');
  const connectionOptions = { address: finalAddress };

  if (useTls) {
    const tlsConfig = {
      serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME || host,
    };

    const caPath = process.env.TEMPORAL_TLS_CA;
    const certPath = process.env.TEMPORAL_TLS_CERT;
    const keyPath = process.env.TEMPORAL_TLS_KEY;

    if (caPath && fs.existsSync(caPath)) {
      tlsConfig.serverRootCACertificate = fs.readFileSync(caPath);
    }

    if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      tlsConfig.clientCertPair = {
        crt: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
    }

    connectionOptions.tls = tlsConfig;
  }

  connectionTarget = {
    configured: address,
    address: finalAddress,
    host: finalAddress.split(':')[0],
    port: port || '443',
    tls: useTls,
  };

  const connection = await NativeConnection.connect(connectionOptions);

  // Dynamically determine task queue based on environment
  const projectId = process.env.FIREBASE_PROJECT_ID || 'invoice-660f3';
  const isProd = projectId === 'carenest-prods' || process.env.NODE_ENV === 'production';
  const taskQueue = `default-${isProd ? 'prod' : 'dev'}`;

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: taskQueue,
    // Path to the workflows bundle/file
    workflowsPath: path.join(__dirname, 'temporal', 'workflows', 'index.js'),
    activities: {
      sendPushNotification,
      sendEmergencyPush,
      processInvoiceActivity,
      sendInvoiceEmailActivity,
      processRecurringInvoicesActivity,
      processRecurringExpensesActivity,
      processOverdueRemindersActivity,
      processDunningActivity,
      processExpenseRemindersActivity,
      processTimesheetRemindersActivity,
      processShiftRemindersActivity,
      processEmailVerificationRemindersActivity,
      cleanupArtifactRegistryActivity,
      processInvoiceAIActivity,
      processTrainingExpiryRemindersActivity,
      processHolidayBalanceAccrualActivity,
      // Employee Onboarding
      generateAndSendVerificationEmail,
      sendVerificationReminderEmail,
      sendOnboardingReminderEmail,
      activateUserAccount,
      sendVerificationEmailActivity,
      sendPasswordResetEmailActivity,
      sendPasswordChangeNotificationActivity,
      sendGenericEmailActivity,
      generateBulkInvoicesActivity,
      upsertWorkedTimeActivity,
      voidShiftArtifactsActivity,
      jwtRotationCheckActivity,
      ndisCatalogSyncActivity,
      leaveApprovalEscalationStepActivity,
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

run().catch(async (err) => {
  logger.error('Failed to start Temporal Worker', err);
  console.error('TEMPORAL WORKER CRASH DETAILS:');
  console.error(err);
  if (err.cause) console.error('Cause:', err.cause);
  try {
    await reportEndpointDiagnosis(err);
  } catch (diagErr) {
    console.error('Endpoint diagnosis failed:', diagErr.message);
  }
  process.exit(1);
});
