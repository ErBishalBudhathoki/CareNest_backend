'use strict';

/**
 * Script to test Temporal Auth Workflow integration.
 * Usage: node scripts/test-auth-temporal.js <email> [type]
 * Types: VERIFICATION (default), PASSWORD_RESET, PASSWORD_CHANGED
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.development') });
const TemporalManager = require('../core/TemporalManager');
const logger = require('../config/logger');

const email = process.argv[2] || 'deverbishal331@gmail.com';
const type = process.argv[3] || 'VERIFICATION';

function getTaskQueue() {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'invoice-660f3';
  const isProd = projectId === 'carenest-prods' || process.env.NODE_ENV === 'production';
  return `default-${isProd ? 'prod' : 'dev'}`;
}

async function runTest() {
  logger.info(`Starting Temporal Auth Test for ${email} with type ${type}...`);
  
  const taskQueue = getTaskQueue();
  const workflowId = `test-auth-${type.toLowerCase()}-${Date.now()}`;
  
  const testData = {
    email: email,
    firstName: 'TestUser',
    otp: '999888'
  };

  try {
    const handle = await TemporalManager.startWorkflow('authNotificationWorkflow', {
      workflowId,
      taskQueue,
      args: [{
        type: type,
        data: testData
      }]
    });

    logger.info(`✅ Workflow started successfully!`);
    logger.info(`   Workflow ID: ${handle.workflowId}`);
    logger.info(`   Task Queue:  ${taskQueue}`);
    logger.info(`   Check the Temporal UI at https://temporal.bishalbudhathoki.com to see progress.`);
    
    // Gracefully close connection
    await TemporalManager.close();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Failed to start Temporal workflow:', error);
    process.exit(1);
  }
}

runTest();
