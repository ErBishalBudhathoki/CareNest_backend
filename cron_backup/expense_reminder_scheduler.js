/**
 * Expense Reminder Scheduler Service
 * Automatically checks for expenses missing receipts and sends reminders
 */

const cron = require('node-cron');
const {
    processAllExpenseReminders,
    DEFAULT_CONFIG
} = require('./services/expenseReminderService');
const { createAuditLog, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('./services/auditService');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

/**
 * Scheduler configuration
 */
const SCHEDULER_CONFIG = {
    // Run every 6 hours (4 times per day)
    DEFAULT_CRON: '0 */6 * * *',

    // Timezone
    DEFAULT_TIMEZONE: 'Australia/Sydney'
};

// Active scheduler instance
let activeScheduler = null;

/**
 * Start the expense reminder scheduler
 */
function startExpenseReminderScheduler() {
    console.log('Starting Expense Reminder Scheduler...');

    if (activeScheduler) {
        console.log('Expense reminder scheduler already running');
        return { success: false, reason: 'already_running' };
    }

    activeScheduler = cron.schedule(SCHEDULER_CONFIG.DEFAULT_CRON, async () => {
        console.log(`[${new Date().toISOString()}] Expense reminder scheduler triggered`);

        try {
            const results = await processAllExpenseReminders();

            // Log processing to audit
            await createAuditLog({
                action: AUDIT_ACTIONS.EXPORT,
                entityType: AUDIT_ENTITIES.EXPENSE || 'EXPENSE',
                entityId: 'scheduled_expense_reminder',
                userEmail: 'system@scheduler',
                organizationId: 'system',
                newValues: {
                    expensesChecked: results.totalExpensesChecked,
                    remindersSent: results.remindersSent,
                    errors: results.errors.length
                },
                reason: 'Scheduled expense receipt reminder processing',
                metadata: {
                    scheduledAt: new Date(),
                    processingType: 'automatic'
                }
            });

        } catch (error) {
            console.error('Error in expense reminder scheduler:', error);
        }
    }, {
        scheduled: false,
        timezone: SCHEDULER_CONFIG.DEFAULT_TIMEZONE
    });

    activeScheduler.start();

    console.log(`Expense reminder scheduler started (every 6 hours, ${SCHEDULER_CONFIG.DEFAULT_TIMEZONE})`);

    return {
        success: true,
        cronExpression: SCHEDULER_CONFIG.DEFAULT_CRON,
        timezone: SCHEDULER_CONFIG.DEFAULT_TIMEZONE
    };
}

/**
 * Stop the expense reminder scheduler
 */
function stopExpenseReminderScheduler() {
    if (activeScheduler) {
        activeScheduler.stop();
        activeScheduler = null;
        console.log('Expense reminder scheduler stopped');
        return { success: true };
    }

    return { success: false, reason: 'not_running' };
}

/**
 * Get scheduler status
 * @returns {object} Scheduler status
 */
function getExpenseSchedulerStatus() {
    return {
        isRunning: activeScheduler !== null,
        cronExpression: SCHEDULER_CONFIG.DEFAULT_CRON,
        timezone: SCHEDULER_CONFIG.DEFAULT_TIMEZONE,
        reminderConfig: DEFAULT_CONFIG
    };
}

/**
 * Manual trigger for testing
 * @param {string} organizationId - Optional org filter
 */
async function manualTriggerExpenseReminders(organizationId = null) {
    console.log(`Manual trigger for expense reminders${organizationId ? ` (org: ${organizationId})` : ''}...`);
    return await processAllExpenseReminders(organizationId);
}

module.exports = {
    startExpenseReminderScheduler,
    stopExpenseReminderScheduler,
    getExpenseSchedulerStatus,
    manualTriggerExpenseReminders,
    SCHEDULER_CONFIG
};
