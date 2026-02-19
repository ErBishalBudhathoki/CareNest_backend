/**
 * Cloud Scheduler Routes
 * HTTP endpoints for Google Cloud Scheduler to trigger scheduled tasks
 * 
 * These endpoints replace node-cron in production environments
 * Local development still uses node-cron (see individual scheduler files)
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');
const { authenticateCloudScheduler, logSchedulerExecution } = require('../middleware/cloudSchedulerAuth');

// Import scheduler services
const notificationScheduler = require('../cron/notificationScheduler');
const invoiceScheduler = require('../cron/scheduler');
const { processDunning } = require('../cron/dunningScheduler');
const { processAllOrganizationsRecurringExpenses } = require('../recurring_expense_scheduler');
const { manualTrigger: triggerTimesheetReminders } = require('../timesheet_reminder_scheduler');
const { manualTriggerExpenseReminders } = require('../expense_reminder_scheduler');

// Rate limiting for scheduler endpoints (very strict as these are internal only)
const schedulerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many scheduler requests.' }
});

// Apply authentication to all scheduler routes
router.use(authenticateCloudScheduler);

/**
 * POST /scheduler/high-frequency
 * 
 * Runs every 15 minutes
 * - Process shift reminders (notify workers of upcoming shifts)
 */
router.post('/high-frequency', schedulerLimiter, logSchedulerExecution('high-frequency'), async (req, res) => {
    try {
        logger.info('=== HIGH-FREQUENCY SCHEDULER TRIGGERED ===');

        const results = {
            timestamp: new Date().toISOString(),
            tasks: []
        };

        // Task 1: Process shift reminders
        try {
            logger.info('Processing shift reminders...');
            await notificationScheduler.processShiftReminders();
            results.tasks.push({
                name: 'shift_reminders',
                status: 'success'
            });
        } catch (error) {
            logger.error('Error processing shift reminders:', error);
            results.tasks.push({
                name: 'shift_reminders',
                status: 'error',
                error: error.message
            });
        }

        // Determine overall status
        const hasErrors = results.tasks.some(t => t.status === 'error');

        res.status(hasErrors ? 500 : 200).json({
            success: !hasErrors,
            message: hasErrors ? 'Some tasks failed' : 'All tasks completed successfully',
            results
        });

    } catch (error) {
        logger.error('High-frequency scheduler error:', error);
        res.status(500).json({
            success: false,
            message: 'Scheduler execution failed',
            error: error.message
        });
    }
});

/**
 * POST /scheduler/medium-frequency
 * 
 * Runs every 6 hours
 * - Process expense reminders (expenses missing receipts)
 */
router.post('/medium-frequency', schedulerLimiter, logSchedulerExecution('medium-frequency'), async (req, res) => {
    try {
        logger.info('=== MEDIUM-FREQUENCY SCHEDULER TRIGGERED ===');

        const results = {
            timestamp: new Date().toISOString(),
            tasks: []
        };

        // Task 1: Process expense reminders
        try {
            logger.info('Processing expense reminders...');
            const expenseResults = await manualTriggerExpenseReminders();
            results.tasks.push({
                name: 'expense_reminders',
                status: 'success',
                details: expenseResults
            });
        } catch (error) {
            logger.error('Error processing expense reminders:', error);
            results.tasks.push({
                name: 'expense_reminders',
                status: 'error',
                error: error.message
            });
        }

        const hasErrors = results.tasks.some(t => t.status === 'error');

        res.status(hasErrors ? 500 : 200).json({
            success: !hasErrors,
            message: hasErrors ? 'Some tasks failed' : 'All tasks completed successfully',
            results
        });

    } catch (error) {
        logger.error('Medium-frequency scheduler error:', error);
        res.status(500).json({
            success: false,
            message: 'Scheduler execution failed',
            error: error.message
        });
    }
});

/**
 * POST /scheduler/daily
 * 
 * Runs once per day at midnight
 * - Process recurring invoices
 * - Send overdue payment reminders
 * - Process dunning (overdue invoice collections)
 * - Process recurring expenses
 * - Send timesheet reminders
 */
router.post('/daily', schedulerLimiter, logSchedulerExecution('daily'), async (req, res) => {
    try {
        logger.info('=== DAILY SCHEDULER TRIGGERED ===');

        const results = {
            timestamp: new Date().toISOString(),
            tasks: []
        };

        // Task 1: Process recurring invoices
        try {
            logger.info('Processing recurring invoices...');
            await invoiceScheduler.processRecurringInvoices();
            results.tasks.push({
                name: 'recurring_invoices',
                status: 'success'
            });
        } catch (error) {
            logger.error('Error processing recurring invoices:', error);
            results.tasks.push({
                name: 'recurring_invoices',
                status: 'error',
                error: error.message
            });
        }

        // Task 2: Process overdue reminders
        try {
            logger.info('Processing overdue payment reminders...');
            await invoiceScheduler.processOverdueReminders();
            results.tasks.push({
                name: 'overdue_reminders',
                status: 'success'
            });
        } catch (error) {
            logger.error('Error processing overdue reminders:', error);
            results.tasks.push({
                name: 'overdue_reminders',
                status: 'error',
                error: error.message
            });
        }

        // Task 3: Process dunning
        try {
            logger.info('Processing dunning...');
            const dunningResult = await processDunning();
            results.tasks.push({
                name: 'dunning',
                status: 'success',
                details: dunningResult
            });
        } catch (error) {
            logger.error('Error processing dunning:', error);
            results.tasks.push({
                name: 'dunning',
                status: 'error',
                error: error.message
            });
        }

        // Task 4: Process recurring expenses
        try {
            logger.info('Processing recurring expenses...');
            const recurringExpenseResults = await processAllOrganizationsRecurringExpenses();
            results.tasks.push({
                name: 'recurring_expenses',
                status: 'success',
                details: recurringExpenseResults
            });
        } catch (error) {
            logger.error('Error processing recurring expenses:', error);
            results.tasks.push({
                name: 'recurring_expenses',
                status: 'error',
                error: error.message
            });
        }

        // Task 5: Send timesheet reminders
        try {
            logger.info('Processing timesheet reminders...');
            const timesheetResults = await triggerTimesheetReminders();
            results.tasks.push({
                name: 'timesheet_reminders',
                status: 'success',
                details: timesheetResults
            });
        } catch (error) {
            logger.error('Error processing timesheet reminders:', error);
            results.tasks.push({
                name: 'timesheet_reminders',
                status: 'error',
                error: error.message
            });
        }

        const hasErrors = results.tasks.some(t => t.status === 'error');

        res.status(hasErrors ? 500 : 200).json({
            success: !hasErrors,
            message: hasErrors ? 'Some tasks failed' : 'All tasks completed successfully',
            results
        });

    } catch (error) {
        logger.error('Daily scheduler error:', error);
        res.status(500).json({
            success: false,
            message: 'Scheduler execution failed',
            error: error.message
        });
    }
});

/**
 * GET /scheduler/status
 * 
 * Health check endpoint to verify scheduler routes are working
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        message: 'Cloud Scheduler routes are active',
        endpoints: {
            highFrequency: '/scheduler/high-frequency (POST)',
            mediumFrequency: '/scheduler/medium-frequency (POST)',
            daily: '/scheduler/daily (POST)'
        },
        environment: process.env.NODE_ENV || 'development'
    });
});

module.exports = router;
