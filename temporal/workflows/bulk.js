const { proxyActivities } = require('@temporalio/workflow');

const { generateBulkInvoicesActivity } = proxyActivities({
  // Bulk sets can be large; allow a long activity run with retries.
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '2 minutes',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Bulk invoice generation job.
 * Started with a deterministic workflow ID
 * (bulk-invoices-{org}-{input hash}) so double-submits collapse via
 * REJECT_DUPLICATE instead of double-invoicing.
 */
async function BulkInvoicesWorkflow(input) {
  const result = await generateBulkInvoicesActivity(input);
  return result;
}

module.exports = {
  BulkInvoicesWorkflow,
};
