/**
 * Timesheet Reminder Routes
 * API endpoints for timesheet reminder management
 */

const express = require('express');
const router = express.Router();

const {
    // processAllTimesheetReminders,
    getUsersWithIncompleteTimesheets,
    getOrganizationReminderSettings,
    updateOrganizationReminderSettings
} = require('../services/timesheetReminderService');

const {
    getSchedulerStatus,
    manualTrigger,
    refreshSchedulers
} = require('../timesheet_reminder_scheduler');

/**
 * GET /api/reminders/timesheet/status
 * Get scheduler status
 */
router.get('/timesheet/status', async (req, res) => {
    try {
        const status = getSchedulerStatus();
        res.status(200).json({
            success: true,
            data: status
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
router.post('/timesheet/trigger', async (req, res) => {
    try {
        const { organizationId } = req.body;

        const result = await manualTrigger(organizationId);

        res.status(200).json({
            success: true,
            data: result
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
router.get('/timesheet/incomplete/:organizationId', async (req, res) => {
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
router.get('/timesheet/settings/:organizationId', async (req, res) => {
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
router.put('/timesheet/settings/:organizationId', async (req, res) => {
    try {
        const { organizationId } = req.params;
        const settings = req.body;

        const result = await updateOrganizationReminderSettings(organizationId, settings);

        if (result.success) {
            // Refresh schedulers to pick up new settings
            await refreshSchedulers();
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
 * Refresh all schedulers (e.g., after settings change)
 */
router.post('/timesheet/refresh', async (req, res) => {
    try {
        await refreshSchedulers();
        const status = getSchedulerStatus();

        res.status(200).json({
            success: true,
            message: 'Schedulers refreshed',
            data: status
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
