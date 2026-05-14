const { proxyActivities } = require('@temporalio/workflow');

const { processInvoiceActivity } = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '15 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * Invoice Processing Workflow.
 * @param {Object} params
 * @param {string} params.shiftId
 * @param {string} params.clientEmail
 * @param {string} params.organizationId
 */
async function InvoiceProcessingWorkflow(params) {
  const result = await processInvoiceActivity(params);
  return result;
}

module.exports = {
  InvoiceProcessingWorkflow
};
