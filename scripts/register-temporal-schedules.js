require('dotenv').config({ path: '../.env.development' });
const TemporalManager = require('../core/TemporalManager');
const logger = require('../config/logger');

const schedules = [
  {
    scheduleId: 'recurring-invoices-schedule',
    cron: '0 0 * * *',
    workflow: 'RecurringInvoiceCronWorkflow'
  },
  {
    scheduleId: 'overdue-reminders-schedule',
    cron: '0 0 * * *',
    workflow: 'OverdueRemindersCronWorkflow'
  },
  {
    scheduleId: 'dunning-schedule',
    cron: '0 9 * * *',
    workflow: 'DunningCronWorkflow'
  },
  {
    scheduleId: 'expense-reminders-schedule',
    cron: '0 */6 * * *',
    workflow: 'ExpenseRemindersCronWorkflow'
  },
  {
    scheduleId: 'timesheet-reminders-schedule',
    cron: '0 * * * *', // Run hourly to check which orgs need reminders right now
    workflow: 'TimesheetRemindersCronWorkflow'
  },
  {
    scheduleId: 'shift-reminders-schedule',
    cron: '*/15 * * * *', // Run every 15 mins
    workflow: 'ShiftRemindersCronWorkflow'
  },
  {
    scheduleId: 'email-verification-schedule',
    cron: '0 10 * * *', // Daily at 10 AM
    workflow: 'EmailVerificationCronWorkflow'
  },
  {
    scheduleId: 'artifact-registry-cleanup-schedule',
    cron: '0 2 * * 0', // Weekly on Sundays at 2 AM UTC
    workflow: 'CleanupArtifactRegistryWorkflow'
  }
];

async function registerSchedules() {
  logger.info('Initializing Temporal schedules...');
  const client = await TemporalManager.getClient();

  for (const s of schedules) {
    try {
      logger.info(`Creating/Updating schedule ${s.scheduleId} (${s.cron}) -> ${s.workflow}`);
      await client.schedule.create({
        scheduleId: s.scheduleId,
        spec: {
          cronExpressions: [s.cron],
          ...(s.scheduleId === 'email-verification-schedule' ? { timezone: 'Australia/Sydney' } : {})
        },
        action: {
          type: 'startWorkflow',
          workflowType: s.workflow,
          taskQueue: 'default',
        },
      });
      logger.info(`✅ Successfully created schedule ${s.scheduleId}`);
    } catch (err) {
      if (err.name === 'ScheduleAlreadyRunning' || (err.message && err.message.includes('already exists'))) {
        try {
          const handle = client.schedule.getHandle(s.scheduleId);
          await handle.update((prev) => ({
            ...prev,
            spec: {
              cronExpressions: [s.cron],
              ...(s.scheduleId === 'email-verification-schedule' ? { timezone: 'Australia/Sydney' } : {})
            },
            action: {
              type: 'startWorkflow',
              workflowType: s.workflow,
              taskQueue: 'default',
            }
          }));
          logger.info(`✅ Successfully updated schedule ${s.scheduleId}`);
        } catch (updateErr) {
          logger.error(`❌ Failed to update schedule ${s.scheduleId}`, updateErr);
        }
      } else {
        logger.error(`❌ Failed to create schedule ${s.scheduleId}`, err);
      }
    }
  }

  logger.info('Finished setting up Temporal schedules.');
}

if (require.main === module) {
  registerSchedules()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { registerSchedules };
