const { proxyActivities } = require('@temporalio/workflow');

const { 
  processRecurringInvoicesActivity, 
  processOverdueRemindersActivity,
  processRecurringExpensesActivity,
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

/**
 * Workflow that generates due recurring expenses across organizations.
 * Intended to be triggered via a Temporal Schedule (daily 06:00).
 * Replaces recurring_expense_scheduler.js (in-process node-cron).
 */
async function RecurringExpenseCronWorkflow() {
  const result = await processRecurringExpensesActivity();
  return result;
}

module.exports = {
  RecurringInvoiceCronWorkflow,
  OverdueRemindersCronWorkflow,
  RecurringExpenseCronWorkflow,
};
