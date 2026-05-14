const { proxyActivities } = require('@temporalio/workflow');

const { sendEmergencyPush } = proxyActivities({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 10,
  },
});

/**
 * Emergency Notification Workflow.
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.email
 * @param {Object} params.notification
 */
async function EmergencyNotificationWorkflow(params) {
  const result = await sendEmergencyPush(params);
  return result;
}

module.exports = {
  EmergencyNotificationWorkflow
};
