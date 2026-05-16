const { proxyActivities } = require('@temporalio/workflow');

const { 
  processDunningActivity,
  processExpenseRemindersActivity,
  processTimesheetRemindersActivity,
  processShiftRemindersActivity,
  processEmailVerificationRemindersActivity,
  cleanupArtifactRegistryActivity
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

/**
 * Workflow that cleans up old Artifact Registry images.
 */
async function CleanupArtifactRegistryWorkflow() {
  try {
    const result = await cleanupArtifactRegistryActivity();
    return { success: true, result };
  } catch (error) {
    // We log the error but don't fail the whole workflow to allow the schedule to continue
    return { success: false, error: error.message };
  }
}

module.exports = {
  DunningCronWorkflow,
  ExpenseRemindersCronWorkflow,
  TimesheetRemindersCronWorkflow,
  ShiftRemindersCronWorkflow,
  EmailVerificationCronWorkflow,
  CleanupArtifactRegistryWorkflow
};
