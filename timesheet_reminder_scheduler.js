/**
 * Timesheet Reminder Scheduler Service
 * Automatically sends timesheet reminders at configured intervals
 */

const cron = require('node-cron');
const {
    processAllTimesheetReminders,
    getOrganizationsWithRemindersEnabled,
    DEFAULT_REMINDER_CONFIG
} = require('./services/timesheetReminderService');
const { createAuditLog, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('./services/auditService');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

/**
 * Scheduler configuration
 */
const SCHEDULER_CONFIG = {
    // Default: Run every Sunday at 6:00 PM
    DEFAULT_CRON: '0 18 * * 0',

    // Timezone (overridden by org settings if available)
    DEFAULT_TIMEZONE: 'Australia/Sydney'
};

// Active scheduler instances
let activeSchedulers = {};

/**
 * Convert day name to cron day number
 * @param {string|number} day - Day name or number
 * @returns {number} Cron day number (0=Sunday, 6=Saturday)
 */
function getDayNumber(day) {
    if (typeof day === 'number') return day;

    const dayMap = {
        'sunday': 0,
        'monday': 1,
        'tuesday': 2,
        'wednesday': 3,
        'thursday': 4,
        'friday': 5,
        'saturday': 6
    };

    return dayMap[day.toLowerCase()] ?? 0;
}

/**
 * Build cron expression from reminder config
 * @param {object} config - Reminder configuration
 * @returns {string} Cron expression
 */
function buildCronExpression(config) {
    const minute = config.reminderMinute ?? 0;
    const hour = config.reminderHour ?? 18;
    const dayOfWeek = getDayNumber(config.reminderDay ?? 'sunday');

    // Format: minute hour * * dayOfWeek
    return `${minute} ${hour} * * ${dayOfWeek}`;
}

/**
 * Process reminders for a single organization
 * @param {object} org - Organization data
 */
async function processOrganizationReminders(org) {
    console.log(`[${new Date().toISOString()}] Processing timesheet reminders for: ${org.organizationName}`);

    try {
        // Import service functions directly to avoid circular dependencies
        const {
            getUsersWithIncompleteTimesheets,
            sendTimesheetReminder
        } = require('./services/timesheetReminderService');

        // Calculate week boundaries
        const now = new Date();
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() + mondayOffset);
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        // Get users with incomplete timesheets
        const users = await getUsersWithIncompleteTimesheets(
            org.organizationId,
            weekStart,
            weekEnd
        );

        console.log(`Found ${users.length} users with incomplete timesheets`);

        let remindersSent = 0;

        for (const user of users) {
            const result = await sendTimesheetReminder(
                user.userEmail,
                org.organizationId,
                {
                    scheduledShifts: user.scheduledShifts,
                    completedShifts: user.completedShifts,
                    missingEntries: user.missingEntries
                }
            );

            if (result.success) {
                remindersSent++;
            }
        }

        // Log the processing
        await createAuditLog({
            action: AUDIT_ACTIONS.EXPORT,
            entityType: AUDIT_ENTITIES.TIMESHEET || 'TIMESHEET',
            entityId: 'scheduled_timesheet_reminder',
            userEmail: 'system@scheduler',
            organizationId: org.organizationId,
            newValues: {
                usersChecked: users.length,
                remindersSent: remindersSent
            },
            reason: 'Scheduled timesheet reminder processing',
            metadata: {
                scheduledAt: new Date(),
                processingType: 'automatic',
                weekStart: weekStart.toISOString(),
                weekEnd: weekEnd.toISOString()
            }
        });

        console.log(`Sent ${remindersSent} reminders for ${org.organizationName}`);

    } catch (error) {
        console.error(`Error processing reminders for ${org.organizationName}:`, error);
    }
}

/**
 * Start the timesheet reminder scheduler
 * Creates individual schedulers for each organization based on their settings
 */
async function startTimesheetReminderScheduler() {
    console.log('Starting Timesheet Reminder Scheduler...');

    try {
        // Get all organizations with reminders enabled
        const organizations = await getOrganizationsWithRemindersEnabled();

        if (organizations.length === 0) {
            console.log('No organizations with timesheet reminders enabled.');

            // Start a default scheduler that will pick up new orgs
            const defaultTask = cron.schedule(SCHEDULER_CONFIG.DEFAULT_CRON, async () => {
                try {
                    await processAllTimesheetReminders();
                } catch (error) {
                    console.error('Error in default timesheet reminder processing:', error);
                }
            }, {
                scheduled: false,
                timezone: SCHEDULER_CONFIG.DEFAULT_TIMEZONE
            });

            defaultTask.start();
            activeSchedulers['default'] = defaultTask;

            console.log(`Default timesheet reminder scheduler started (Sunday 6 PM ${SCHEDULER_CONFIG.DEFAULT_TIMEZONE})`);

            return {
                type: 'default',
                schedulers: { default: activeSchedulers['default'] }
            };
        }

        // Create individual schedulers for organizations with custom settings
        const organizationsBySchedule = {};

        for (const org of organizations) {
            const config = org.reminderConfig;
            const cronExpr = buildCronExpression(config);
            const timezone = config.timezone || SCHEDULER_CONFIG.DEFAULT_TIMEZONE;
            const scheduleKey = `${cronExpr}_${timezone}`;

            if (!organizationsBySchedule[scheduleKey]) {
                organizationsBySchedule[scheduleKey] = {
                    cronExpr,
                    timezone,
                    organizations: []
                };
            }

            organizationsBySchedule[scheduleKey].organizations.push(org);
        }

        // Create a scheduler for each unique schedule
        for (const [key, schedule] of Object.entries(organizationsBySchedule)) {
            const task = cron.schedule(schedule.cronExpr, async () => {
                console.log(`[${new Date().toISOString()}] Timesheet reminder scheduler triggered for ${schedule.organizations.length} organizations`);

                for (const org of schedule.organizations) {
                    try {
                        await processOrganizationReminders(org);
                    } catch (error) {
                        console.error(`Error processing org ${org.organizationId}:`, error);
                    }
                }
            }, {
                scheduled: false,
                timezone: schedule.timezone
            });

            task.start();
            activeSchedulers[key] = task;

            const orgNames = schedule.organizations.map(o => o.organizationName).join(', ');
            console.log(`Scheduler started: ${schedule.cronExpr} (${schedule.timezone}) for: ${orgNames}`);
        }

        console.log(`Timesheet reminder scheduler started with ${Object.keys(activeSchedulers).length} schedule(s)`);

        return {
            type: 'per-organization',
            schedulerCount: Object.keys(activeSchedulers).length,
            organizations: organizations.length
        };

    } catch (error) {
        console.error('Error starting timesheet reminder scheduler:', error);
        throw error;
    }
}

/**
 * Stop all active schedulers
 */
function stopTimesheetReminderScheduler() {
    console.log('Stopping timesheet reminder schedulers...');

    for (const [key, task] of Object.entries(activeSchedulers)) {
        task.stop();
        console.log(`Stopped scheduler: ${key}`);
    }

    activeSchedulers = {};
    console.log('All timesheet reminder schedulers stopped.');
}

/**
 * Get scheduler status
 * @returns {object} Status of all active schedulers
 */
function getSchedulerStatus() {
    const statuses = {};

    for (const [key, task] of Object.entries(activeSchedulers)) {
        statuses[key] = {
            isRunning: task.getStatus() === 'scheduled',
            nextExecution: task.nextDates ? task.nextDates(1) : 'unknown'
        };
    }

    return {
        activeSchedulers: Object.keys(activeSchedulers).length,
        schedules: statuses,
        defaultConfig: SCHEDULER_CONFIG
    };
}

/**
 * Refresh schedulers (e.g., when org settings change)
 */
async function refreshSchedulers() {
    console.log('Refreshing timesheet reminder schedulers...');
    stopTimesheetReminderScheduler();
    await startTimesheetReminderScheduler();
}

/**
 * Manual trigger for testing
 * @param {string} organizationId - Optional specific org to process
 */
async function manualTrigger(organizationId = null) {
    console.log(`Manual trigger for timesheet reminders${organizationId ? ` (org: ${organizationId})` : ''}...`);

    if (organizationId) {
        const orgs = await getOrganizationsWithRemindersEnabled();
        const org = orgs.find(o => o.organizationId === organizationId);

        if (org) {
            await processOrganizationReminders(org);
            return { success: true, organizationId };
        } else {
            return { success: false, error: 'Organization not found or reminders not enabled' };
        }
    } else {
        return await processAllTimesheetReminders();
    }
}

module.exports = {
    startTimesheetReminderScheduler,
    stopTimesheetReminderScheduler,
    getSchedulerStatus,
    refreshSchedulers,
    manualTrigger,
    processOrganizationReminders,
    buildCronExpression,
    SCHEDULER_CONFIG
};
