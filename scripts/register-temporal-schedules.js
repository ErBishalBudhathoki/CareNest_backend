// Dynamically determine environment
const projectId = process.env.FIREBASE_PROJECT_ID || 'invoice-660f3';
const isProd = projectId === 'carenest-prods' || process.env.NODE_ENV === 'production';
const envSuffix = isProd ? '-prod' : '-dev';
const taskQueue = `default${envSuffix}`;

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
    cron: '0 * * * *',
    workflow: 'TimesheetRemindersCronWorkflow'
  },
  {
    scheduleId: 'shift-reminders-schedule',
    cron: '*/15 * * * *',
    workflow: 'ShiftRemindersCronWorkflow'
  },
  {
    scheduleId: 'email-verification-schedule',
    cron: '0 10 * * *',
    workflow: 'EmailVerificationCronWorkflow'
  },
  {
    scheduleId: 'artifact-registry-cleanup-schedule',
    cron: '0 2 * * 0',
    workflow: 'CleanupArtifactRegistryWorkflow'
  }
];

async function registerSchedules() {
  logger.info(`Initializing Temporal schedules for ${isProd ? 'Production' : 'Development'} (Queue: ${taskQueue})...`);
  const client = await TemporalManager.getClient();

  for (const s of schedules) {
    const uniqueScheduleId = `${s.scheduleId}${envSuffix}`;
    try {
      logger.info(`Creating/Updating schedule ${uniqueScheduleId} (${s.cron}) -> ${s.workflow}`);
      await client.schedule.create({
        scheduleId: uniqueScheduleId,
        spec: {
          cronExpressions: [s.cron],
          ...(s.scheduleId === 'email-verification-schedule' ? { timezone: 'Australia/Sydney' } : {})
        },
        action: {
          type: 'startWorkflow',
          workflowType: s.workflow,
          taskQueue: taskQueue,
        },
      });
      logger.info(`✅ Successfully created schedule ${uniqueScheduleId}`);
    } catch (err) {
      if (err.name === 'ScheduleAlreadyRunning' || (err.message && err.message.includes('already exists'))) {
        try {
          const handle = client.schedule.getHandle(uniqueScheduleId);
          await handle.update((prev) => ({
            ...prev,
            spec: {
              cronExpressions: [s.cron],
              ...(s.scheduleId === 'email-verification-schedule' ? { timezone: 'Australia/Sydney' } : {})
            },
            action: {
              type: 'startWorkflow',
              workflowType: s.workflow,
              taskQueue: taskQueue,
            }
          }));
          logger.info(`✅ Successfully updated schedule ${uniqueScheduleId}`);
        } catch (updateErr) {
          logger.error(`❌ Failed to update schedule ${uniqueScheduleId}`, updateErr);
        }
      } else {
        logger.error(`❌ Failed to create schedule ${uniqueScheduleId}`, err);
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
