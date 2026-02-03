/**
 * Expense Reminder Routes
 * API endpoints for expense reminder management
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser, requireRoles } = require('../middleware/auth');

const {
    getExpensesMissingReceipts,
    getOrganizationExpenseReminderSettings,
    updateOrganizationExpenseReminderSettings,
    getExpenseReminderStatus
} = require('../services/expenseReminderService');

const {
    getExpenseSchedulerStatus,
    manualTriggerExpenseReminders
} = require('../expense_reminder_scheduler');

// Rate limiting
const reminderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many reminder requests.' }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: 'Too many requests.' }
});

const triggerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many trigger requests.' }
});

// Validation rules
const organizationIdParamValidation = [
    param('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const expenseIdParamValidation = [
    param('expenseId').isMongoId().withMessage('Valid expense ID is required')
];

const triggerValidation = [
    body('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

const settingsValidation = [
    param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
    body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
    body('reminderIntervalDays').optional().isInt({ min: 1, max: 30 }).withMessage('Reminder interval must be between 1 and 30 days'),
    body('maxReminders').optional().isInt({ min: 1, max: 10 }).withMessage('Max reminders must be between 1 and 10'),
    body('notifyManagers').optional().isBoolean().withMessage('notifyManagers must be a boolean'),
    body('excludeCategories').optional().isArray().withMessage('excludeCategories must be an array')
];

// Apply authentication to all routes
router.use(authenticateUser);

/**
 * GET /api/reminders/expense/status
 * Get expense reminder scheduler status
 */
router.get('/expense/status', reminderLimiter, async (req, res) => {
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
router.post('/expense/trigger', requireRoles(['admin']), triggerLimiter, triggerValidation, handleValidationErrors, async (req, res) => {
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
router.get('/expense/missing/:organizationId', reminderLimiter, organizationIdParamValidation, handleValidationErrors, async (req, res) => {
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
router.get('/expense/:expenseId/status', reminderLimiter, expenseIdParamValidation, handleValidationErrors, async (req, res) => {
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
router.get('/expense/settings/:organizationId', reminderLimiter, organizationIdParamValidation, handleValidationErrors, async (req, res) => {
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
router.put('/expense/settings/:organizationId', strictLimiter, requireRoles(['admin']), settingsValidation, handleValidationErrors, async (req, res) => {
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
