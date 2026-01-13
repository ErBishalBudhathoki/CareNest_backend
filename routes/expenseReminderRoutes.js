/**
 * Expense Reminder Routes
 * API endpoints for expense reminder management
 */

const express = require('express');
const router = express.Router();

const {
    processAllExpenseReminders,
    getExpensesMissingReceipts,
    getOrganizationExpenseReminderSettings,
    updateOrganizationExpenseReminderSettings,
    getExpenseReminderStatus
} = require('../services/expenseReminderService');

const {
    getExpenseSchedulerStatus,
    manualTriggerExpenseReminders
} = require('../expense_reminder_scheduler');

/**
 * GET /api/reminders/expense/status
 * Get expense reminder scheduler status
 */
router.get('/expense/status', async (req, res) => {
    try {
        const status = getExpenseSchedulerStatus();
        res.status(200).json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error getting expense scheduler status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get scheduler status',
            error: error.message
        });
    }
});

/**
 * POST /api/reminders/expense/trigger
 * Manually trigger expense reminders (for testing)
 */
router.post('/expense/trigger', async (req, res) => {
    try {
        const { organizationId } = req.body;

        const result = await manualTriggerExpenseReminders(organizationId);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error triggering expense reminders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger expense reminders',
            error: error.message
        });
    }
});

/**
 * GET /api/reminders/expense/missing/:organizationId
 * Get expenses missing receipts for an organization
 */
router.get('/expense/missing/:organizationId', async (req, res) => {
    try {
        const { organizationId } = req.params;

        const expenses = await getExpensesMissingReceipts(organizationId);

        res.status(200).json({
            success: true,
            data: {
                count: expenses.length,
                expenses: expenses.map(e => ({
                    id: e._id,
                    amount: e.amount,
                    category: e.category,
                    description: e.description,
                    createdAt: e.createdAt,
                    submittedBy: e.submittedBy,
                    reminderCount: e.receiptReminderCount || 0,
                    lastReminder: e.lastReceiptReminder
                }))
            }
        });
    } catch (error) {
        console.error('Error getting expenses missing receipts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get expenses missing receipts',
            error: error.message
        });
    }
});

/**
 * GET /api/reminders/expense/:expenseId/status
 * Get reminder status for a specific expense
 */
router.get('/expense/:expenseId/status', async (req, res) => {
    try {
        const { expenseId } = req.params;

        const status = await getExpenseReminderStatus(expenseId);

        res.status(200).json(status);
    } catch (error) {
        console.error('Error getting expense reminder status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get expense reminder status',
            error: error.message
        });
    }
});

/**
 * GET /api/reminders/expense/settings/:organizationId
 * Get expense reminder settings for an organization
 */
router.get('/expense/settings/:organizationId', async (req, res) => {
    try {
        const { organizationId } = req.params;

        const settings = await getOrganizationExpenseReminderSettings(organizationId);

        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('Error getting expense reminder settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get expense reminder settings',
            error: error.message
        });
    }
});

/**
 * PUT /api/reminders/expense/settings/:organizationId
 * Update expense reminder settings for an organization
 */
router.put('/expense/settings/:organizationId', async (req, res) => {
    try {
        const { organizationId } = req.params;
        const settings = req.body;

        const result = await updateOrganizationExpenseReminderSettings(organizationId, settings);

        res.status(200).json({
            success: result.success,
            data: result
        });
    } catch (error) {
        console.error('Error updating expense reminder settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update expense reminder settings',
            error: error.message
        });
    }
});

module.exports = router;
