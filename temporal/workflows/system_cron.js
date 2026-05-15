const { proxyActivities } = require('@temporalio/workflow');

const { 
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity
} = proxyActivities({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Workflow that runs the daily dunning process.
 */
async function DunningCronWorkflow() {
  const result = await processDunningActivity();
  return result;
}

/**
 * Workflow that runs expense reminders.
 */
async function ExpenseRemindersCronWorkflow() {
  const result = await processExpenseRemindersActivity();
  return result;
}

/**
 * Workflow that runs timesheet reminders.
 */
async function TimesheetRemindersCronWorkflow() {
  const result = await processTimesheetRemindersActivity();
  return result;
}

/**
 * Workflow that runs shift reminders.
 */
async function ShiftRemindersCronWorkflow() {
  const result = await processShiftRemindersActivity();
  return result;
}

/**
 * Workflow that runs email verification reminders.
 */
async function EmailVerificationCronWorkflow() {
  const result = await processEmailVerificationRemindersActivity();
  return result;
}

module.exports = {
  DunningCronWorkflow,
  ExpenseRemindersCronWorkflow,
  TimesheetRemindersCronWorkflow,
  ShiftRemindersCronWorkflow,
  EmailVerificationCronWorkflow
};
