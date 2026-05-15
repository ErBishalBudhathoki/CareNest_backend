/**
 * Timesheet Reminder Routes
 * API endpoints for timesheet reminder management
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser, requireRoles } = require('../middleware/auth');

const {
    getUsersWithIncompleteTimesheets,
    getOrganizationReminderSettings,
    updateOrganizationReminderSettings
} = require('../services/timesheetReminderService');

const TemporalManager = require('../core/TemporalManager');

// Rate limiting configurations
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

const triggerValidation = [
    body('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

const settingsValidation = [
    param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
    body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
    body('reminderDays').optional().isArray().withMessage('Reminder days must be an array'),
    body('reminderDays.*').optional().isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']).withMessage('Invalid day'),
    body('reminderTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Reminder time must be in HH:MM format'),
    body('notifyManagers').optional().isBoolean().withMessage('notifyManagers must be a boolean')
];

// Apply authentication to all routes
router.use(authenticateUser);

/**
 * GET /api/reminders/timesheet/status
 * Get scheduler status (Legacy, now handled by Temporal)
 */
router.get('/timesheet/status', reminderLimiter, async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: { message: "Timesheet scheduling is managed dynamically by Temporal Workflows." }
        });
    } catch (error) {
        console.error('Error getting scheduler status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get scheduler status',
            error: error.message
        });
    }
});

/**
 * POST /api/reminders/timesheet/trigger
 * Manually trigger timesheet reminders (for testing)
 */
router.post('/timesheet/trigger', requireRoles(['admin']), triggerLimiter, triggerValidation, handleValidationErrors, async (req, res) => {
    try {
        const { organizationId } = req.body;

        await TemporalManager.startWorkflow('TimesheetRemindersCronWorkflow', {
            workflowId: `manual-timesheet-reminders-${organizationId || 'all'}-${Date.now()}`,
        });

        res.status(200).json({
            success: true,
            data: { message: "Timesheet reminder workflow manually triggered via Temporal" }
        });
    } catch (error) {
        console.error('Error triggering timesheet reminders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger timesheet reminders',
            error: error.message
        });
    }
});

/**
 * GET /api/reminders/timesheet/incomplete/:organizationId
 * Get users with incomplete timesheets for current week
 */
router.get('/timesheet/incomplete/:organizationId', reminderLimiter, organizationIdParamValidation, handleValidationErrors, async (req, res) => {
    try {
        const { organizationId } = req.params;

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

        const users = await getUsersWithIncompleteTimesheets(
            organizationId,
            weekStart,
            weekEnd
        );

        res.status(200).json({
            success: true,
            data: {
                weekStart: weekStart.toISOString(),
                weekEnd: weekEnd.toISOString(),
                usersWithIncompleteTimesheets: users
            }
        });
    } catch (error) {
        console.error('Error getting incomplete timesheets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get incomplete timesheets',
            error: error.message
        });
    }
});

/**
 * GET /api/reminders/timesheet/settings/:organizationId
 * Get reminder settings for an organization
 */
router.get('/timesheet/settings/:organizationId', reminderLimiter, organizationIdParamValidation, handleValidationErrors, async (req, res) => {
    try {
        const { organizationId } = req.params;

        const settings = await getOrganizationReminderSettings(organizationId);

        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('Error getting reminder settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get reminder settings',
            error: error.message
        });
    }
});

/**
 * PUT /api/reminders/timesheet/settings/:organizationId
 * Update reminder settings for an organization
 */
router.put('/timesheet/settings/:organizationId', strictLimiter, requireRoles(['admin']), settingsValidation, handleValidationErrors, async (req, res) => {
    try {
        const { organizationId } = req.params;
        const settings = req.body;

        const result = await updateOrganizationReminderSettings(organizationId, settings);

        if (result.success) {
            // Temporal workflows read settings dynamically on their next execution.
            // No need to restart in-memory schedulers.
        }

        res.status(200).json({
            success: result.success,
            data: result
        });
    } catch (error) {
        console.error('Error updating reminder settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update reminder settings',
            error: error.message
        });
    }
});

/**
 * POST /api/reminders/timesheet/refresh
 * Refresh all schedulers (Legacy, now handled by Temporal)
 */
router.post('/timesheet/refresh', strictLimiter, requireRoles(['admin']), async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            message: 'Schedulers refreshed (managed automatically by Temporal)',
            data: { message: "Temporal handles schedules dynamically." }
        });
    } catch (error) {
        console.error('Error refreshing schedulers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to refresh schedulers',
            error: error.message
        });
    }
});

module.exports = router;
