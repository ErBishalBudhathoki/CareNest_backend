const { proxyActivities } = require('@temporalio/workflow');

const { 
  processRecurringInvoicesActivity, 
  processOverdueRemindersActivity 
} = proxyActivities({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Workflow that handles processing recurring invoices.
 * Intended to be triggered via a Temporal CronSchedule (e.g. daily at midnight).
 */
async function RecurringInvoiceCronWorkflow() {
  const result = await processRecurringInvoicesActivity();
  return result;
}

/**
 * Workflow that handles processing overdue reminders.
 * Intended to be triggered via a Temporal CronSchedule (e.g. daily at midnight).
 */
async function OverdueRemindersCronWorkflow() {
  const result = await processOverdueRemindersActivity();
  return result;
}

module.exports = {
  RecurringInvoiceCronWorkflow,
  OverdueRemindersCronWorkflow
};
