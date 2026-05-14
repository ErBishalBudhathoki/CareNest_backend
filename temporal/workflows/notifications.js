const { proxyActivities } = require('@temporalio/workflow');

const { sendPushNotification } = proxyActivities({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '10 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * Workflow to handle standard push notifications.
 * @param {Object} params
 * @param {string} params.userId
 * @param {Object} params.notification
 * @param {string} [params.historyId]
 */
async function NotificationWorkflow(params) {
  // Execute the activity. Retries are handled automatically by Temporal.
  const result = await sendPushNotification(params);
  return result;
}

module.exports = {
  NotificationWorkflow
};
