/**
 * Timesheet Reminder Service
 * Business logic for checking incomplete timesheets and sending reminders
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Organization = require('../models/Organization');
const User = require('../models/User');
const ClientAssignment = require('../models/ClientAssignment');
const WorkedTime = require('../models/WorkedTime');
const FcmToken = require('../models/FcmToken');
const ReminderLog = require('../models/ReminderLog');

/**
 * Default reminder configuration
 */
const DEFAULT_REMINDER_CONFIG = {
    enabled: true,
    reminderDay: 0, // 0 = Sunday
    reminderHour: 18, // 6 PM
    reminderMinute: 0,
    timezone: 'Australia/Sydney'
};

/**
 * Get organizations with timesheet reminder settings enabled
 * @returns {Promise<Array>} List of organizations with their reminder settings
 */
async function getOrganizationsWithRemindersEnabled() {
    try {
        // Get organizations that have reminders enabled (or use default if not set)
        const organizations = await Organization.find({
            isActive: { $ne: false }
        });

        // Filter to only those with reminders enabled (default is enabled)
        const enabledOrgs = organizations.filter(org => {
            const config = org.timesheetReminders || DEFAULT_REMINDER_CONFIG;
            return config.enabled !== false;
        });

        return enabledOrgs.map(org => ({
            organizationId: org._id.toString(),
            organizationName: org.businessName || org.name || 'Unknown',
            reminderConfig: org.timesheetReminders || DEFAULT_REMINDER_CONFIG
        }));

    } catch (error) {
        console.error('Error getting organizations with reminders:', error);
        return [];
    }
}

/**
 * Get users with incomplete timesheets for a given week
 * @param {string} organizationId - Organization ID to check
 * @param {Date} weekStart - Start of the week (Monday)
 * @param {Date} weekEnd - End of the week (Sunday)
 * @returns {Promise<Array>} Users with incomplete timesheets
 */
async function getUsersWithIncompleteTimesheets(organizationId, weekStart, weekEnd) {
    try {
        // 1. Get all active employees in this organization
        // Using User model (standardized)
        const employees = await User.find({
            organizationId: organizationId,
            isActive: { $ne: false },
            // Optional: filter by role if needed, e.g., role: 'user' or 'employee'
            // For now, assuming all active users in org are employees/users
        });

        if (employees.length === 0) {
            console.log(`No active employees found for organization ${organizationId}`);
            return [];
        }

        const usersWithIncompleteTimesheets = [];

        for (const employee of employees) {
            const userEmail = employee.email;

            if (!userEmail) continue;

            // 2. Get scheduled shifts for this user in the week (via shiftsWithDateRange)
            // Also check schedules stored differently
            const shiftsWithDateRange = await ClientAssignment.find({
                userEmail: userEmail,
                organizationId: organizationId,
                isActive: true
            });

            // Count total scheduled shifts for the week
            let scheduledShiftCount = 0;

            for (const assignment of shiftsWithDateRange) {
                if (assignment.schedule && Array.isArray(assignment.schedule)) {
                    for (const shift of assignment.schedule) {
                        if (shift.date) {
                            const shiftDate = new Date(shift.date);
                            if (shiftDate >= weekStart && shiftDate <= weekEnd) {
                                scheduledShiftCount++;
                            }
                        }
                    }
                }
            }

            // 3. Get actual worked time entries for this user in the week
            const workedTimeEntries = await WorkedTime.find({
                userEmail: userEmail,
                isActive: true,
                $or: [
                    {
                        shiftDate: {
                            $gte: weekStart.toISOString().split('T')[0],
                            $lte: weekEnd.toISOString().split('T')[0]
                        }
                    },
                    {
                        workDate: {
                            $gte: weekStart,
                            $lte: weekEnd
                        }
                    }
                ]
            });

            const workedEntryCount = workedTimeEntries.length;

            // 4. Check if timesheet is incomplete
            // User has incomplete timesheet if:
            // - They have scheduled shifts but fewer worked entries
            // - OR they have shifts but no worked entries at all
            if (scheduledShiftCount > 0 && workedEntryCount < scheduledShiftCount) {
                usersWithIncompleteTimesheets.push({
                    userEmail: userEmail,
                    employeeName: `${employee.firstName} ${employee.lastName}`.trim() || userEmail.split('@')[0],
                    scheduledShifts: scheduledShiftCount,
                    completedShifts: workedEntryCount,
                    missingEntries: scheduledShiftCount - workedEntryCount
                });
            }
        }

        return usersWithIncompleteTimesheets;

    } catch (error) {
        console.error('Error getting users with incomplete timesheets:', error);
        throw error;
    }
}

/**
 * Send timesheet reminder notification to a user
 * @param {string} userEmail - User's email
 * @param {string} organizationId - Organization ID
 * @param {object} details - Details about missing entries
 * @returns {Promise<object>} Result of notification send
 */
async function sendTimesheetReminder(userEmail, organizationId, details) {
    try {
        // Get FCM token for user
        const tokenDoc = await FcmToken.findOne({ userEmail: userEmail });

        if (!tokenDoc || !tokenDoc.fcmToken) {
            console.log(`No FCM token found for user ${userEmail}`);
            return { success: false, reason: 'no_fcm_token' };
        }

        // Import Firebase Admin
        const admin = require('../config/firebase');

        // Construct notification message
        const missingText = details.missingEntries === 1
            ? '1 shift entry'
            : `${details.missingEntries} shift entries`;

        const message = {
            notification: {
                title: '⏰ Timesheet Reminder',
                body: `You have ${missingText} missing this week. Please complete your timesheet before the deadline.`
            },
            data: {
                type: 'timesheet_reminder',
                channelId: 'timesheet_reminders',
                userEmail: userEmail,
                organizationId: organizationId,
                scheduledShifts: details.scheduledShifts.toString(),
                completedShifts: details.completedShifts.toString(),
                missingEntries: details.missingEntries.toString(),
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                timestamp: new Date().toISOString()
            },
            android: {
                priority: 'high',
                notification: {
                    channel_id: 'timesheet_reminders',
                    sound: 'default',
                    priority: 'high'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        'content-available': 1
                    }
                },
                headers: {
                    'apns-priority': '10'
                }
            },
            token: tokenDoc.fcmToken
        };

        // Send the notification
        const response = await admin.messaging().send(message);

        console.log(`Timesheet reminder sent to ${userEmail}: ${response}`);

        // Log the reminder in a tracking collection
        await ReminderLog.create({
            type: 'timesheet_reminder',
            userEmail: userEmail,
            organizationId: organizationId,
            details: details,
            sentAt: new Date(),
            fcmResponse: response
        });

        return { success: true, messageId: response };

    } catch (error) {
        console.error(`Error sending timesheet reminder to ${userEmail}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Process timesheet reminders for all organizations
 * @returns {Promise<object>} Processing results
 */
async function processAllTimesheetReminders() {
    console.log(`[${new Date().toISOString()}] Starting timesheet reminder processing...`);

    const results = {
        totalOrganizations: 0,
        successfulOrganizations: 0,
        totalRemindersent: 0,
        errors: []
    };

    try {
        // Get all organizations with reminders enabled
        const organizations = await getOrganizationsWithRemindersEnabled();
        results.totalOrganizations = organizations.length;

        if (organizations.length === 0) {
            console.log('No organizations with timesheet reminders enabled.');
            return results;
        }

        // Calculate week boundaries (Monday to Sunday)
        const now = new Date();
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() + mondayOffset);
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        console.log(`Checking timesheets for week: ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);

        // Process each organization
        for (const org of organizations) {
            try {
                console.log(`Processing organization: ${org.organizationName} (${org.organizationId})`);

                const usersWithIncomplete = await getUsersWithIncompleteTimesheets(
                    org.organizationId,
                    weekStart,
                    weekEnd
                );

                console.log(`Found ${usersWithIncomplete.length} users with incomplete timesheets`);

                // Send reminders to each user
                for (const user of usersWithIncomplete) {
                    const sendResult = await sendTimesheetReminder(
                        user.userEmail,
                        org.organizationId,
                        {
                            scheduledShifts: user.scheduledShifts,
                            completedShifts: user.completedShifts,
                            missingEntries: user.missingEntries
                        }
                    );

                    if (sendResult.success) {
                        results.totalRemindersent++;
                    }
                }

                results.successfulOrganizations++;

            } catch (orgError) {
                console.error(`Error processing organization ${org.organizationId}:`, orgError);
                results.errors.push({
                    organizationId: org.organizationId,
                    error: orgError.message
                });
            }
        }

        console.log(`[${new Date().toISOString()}] Timesheet reminder processing completed.`);
        console.log(`- Organizations processed: ${results.successfulOrganizations}/${results.totalOrganizations}`);
        console.log(`- Total reminders sent: ${results.totalRemindersent}`);

        return results;

    } catch (error) {
        console.error('Error in timesheet reminder processing:', error);
        throw error;
    }
}

/**
 * Get reminder settings for an organization
 * @param {string} organizationId - Organization ID
 * @returns {Promise<object>} Reminder configuration
 */
async function getOrganizationReminderSettings(organizationId) {
    try {
        const org = await Organization.findById(organizationId);

        if (!org) {
            return DEFAULT_REMINDER_CONFIG;
        }

        return org.timesheetReminders || DEFAULT_REMINDER_CONFIG;

    } catch (error) {
        console.error('Error getting organization reminder settings:', error);
        return DEFAULT_REMINDER_CONFIG;
    }
}

/**
 * Update reminder settings for an organization
 * @param {string} organizationId - Organization ID
 * @param {object} settings - New reminder settings
 * @returns {Promise<object>} Update result
 */
async function updateOrganizationReminderSettings(organizationId, settings) {
    try {
        const result = await Organization.updateOne(
            { _id: organizationId },
            {
                $set: {
                    timesheetReminders: {
                        enabled: settings.enabled !== false,
                        reminderDay: settings.reminderDay ?? DEFAULT_REMINDER_CONFIG.reminderDay,
                        reminderHour: settings.reminderHour ?? DEFAULT_REMINDER_CONFIG.reminderHour,
                        reminderMinute: settings.reminderMinute ?? DEFAULT_REMINDER_CONFIG.reminderMinute,
                        timezone: settings.timezone || DEFAULT_REMINDER_CONFIG.timezone,
                        updatedAt: new Date()
                    }
                }
            }
        );

        return { success: true, modifiedCount: result.modifiedCount };

    } catch (error) {
        console.error('Error updating organization reminder settings:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    getOrganizationsWithRemindersEnabled,
    getUsersWithIncompleteTimesheets,
    sendTimesheetReminder,
    processAllTimesheetReminders,
    getOrganizationReminderSettings,
    updateOrganizationReminderSettings,
    DEFAULT_REMINDER_CONFIG
};
