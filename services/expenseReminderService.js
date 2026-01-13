/**
 * Expense Reminder Service
 * Business logic for checking expenses missing receipts and sending reminders
 */

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGODB_URI;
const DB_NAME = 'Invoice';

/**
 * Default reminder configuration
 */
const DEFAULT_CONFIG = {
    enabled: true,
    reminderAfterHours: 48, // Hours after expense creation to send reminder
    maxReminders: 3,        // Maximum reminders per expense
    reminderIntervalHours: 24 // Hours between subsequent reminders
};

/**
 * Check if an expense has a receipt attached
 * @param {object} expense - Expense document
 * @returns {boolean} True if receipt exists
 */
function hasReceipt(expense) {
    return !!(
        expense.receiptUrl ||
        (expense.receiptMetadata && Object.keys(expense.receiptMetadata).length > 0) ||
        (expense.receiptFiles && expense.receiptFiles.length > 0) ||
        (expense.receiptPhotos && expense.receiptPhotos.length > 0)
    );
}

/**
 * Get expenses that are missing receipts and due for reminder
 * @param {string} organizationId - Optional, filter by organization
 * @returns {Promise<Array>} Expenses needing receipt reminders
 */
async function getExpensesMissingReceipts(organizationId = null) {
    let client;

    try {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db(DB_NAME);

        const now = new Date();
        const reminderThreshold = new Date(now.getTime() - (DEFAULT_CONFIG.reminderAfterHours * 60 * 60 * 1000));

        // Build query for expenses missing receipts
        const query = {
            isActive: true,
            status: { $nin: ['cancelled', 'processed'] },
            createdAt: { $lte: reminderThreshold },
            // All receipt fields are null/empty
            $and: [
                { $or: [{ receiptUrl: null }, { receiptUrl: '' }] },
                { $or: [{ receiptFiles: null }, { receiptFiles: { $size: 0 } }] },
                { $or: [{ receiptPhotos: null }, { receiptPhotos: { $size: 0 } }] }
            ],
            // Not already reminded max times or not reminded recently
            $or: [
                { 'receiptReminderCount': { $exists: false } },
                { 'receiptReminderCount': { $lt: DEFAULT_CONFIG.maxReminders } }
            ]
        };

        if (organizationId) {
            query.organizationId = organizationId;
        }

        const expenses = await db.collection('expenses').find(query).toArray();

        // Filter out expenses that were reminded too recently
        const eligibleExpenses = expenses.filter(expense => {
            if (!expense.lastReceiptReminder) return true;

            const lastReminderTime = new Date(expense.lastReceiptReminder);
            const hoursSinceLastReminder = (now.getTime() - lastReminderTime.getTime()) / (1000 * 60 * 60);

            return hoursSinceLastReminder >= DEFAULT_CONFIG.reminderIntervalHours;
        });

        // Double-check receipt status using our helper function
        const expensesMissingReceipts = eligibleExpenses.filter(expense => !hasReceipt(expense));

        return expensesMissingReceipts;

    } catch (error) {
        console.error('Error getting expenses missing receipts:', error);
        throw error;
    } finally {
        if (client) {
            await client.close();
        }
    }
}

/**
 * Send receipt reminder for an expense
 * @param {object} expense - Expense document
 * @returns {Promise<object>} Result of notification send
 */
async function sendReceiptReminder(expense) {
    let client;

    try {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db(DB_NAME);

        const userEmail = expense.submittedBy || expense.createdBy;

        if (!userEmail) {
            console.log(`No user email for expense ${expense._id}`);
            return { success: false, reason: 'no_user_email' };
        }

        // Get FCM token for user
        const tokenDoc = await db.collection('fcmTokens').findOne({ userEmail: userEmail });

        if (!tokenDoc || !tokenDoc.fcmToken) {
            console.log(`No FCM token found for user ${userEmail}`);
            return { success: false, reason: 'no_fcm_token' };
        }

        // Import Firebase Admin
        const admin = require('../config/firebase');

        // Calculate hours since creation
        const hoursSinceCreation = Math.floor(
            (Date.now() - new Date(expense.createdAt).getTime()) / (1000 * 60 * 60)
        );

        // Format expense info for notification
        const amountFormatted = expense.amount ? `$${expense.amount.toFixed(2)}` : 'N/A';
        const categoryDisplay = expense.category || 'Uncategorized';

        const message = {
            notification: {
                title: '🧾 Receipt Reminder',
                body: `Your ${categoryDisplay} expense (${amountFormatted}) is missing a receipt. Please upload it to complete your record.`
            },
            data: {
                type: 'expense_reminder',
                channelId: 'expense_reminders',
                expenseId: expense._id.toString(),
                userEmail: userEmail,
                organizationId: expense.organizationId || '',
                category: expense.category || '',
                amount: expense.amount?.toString() || '0',
                hoursSinceCreation: hoursSinceCreation.toString(),
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                timestamp: new Date().toISOString()
            },
            android: {
                priority: 'high',
                notification: {
                    channel_id: 'expense_reminders',
                    sound: 'default',
                    priority: 'default'
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
                    'apns-priority': '5' // Normal priority for non-urgent reminder
                }
            },
            token: tokenDoc.fcmToken
        };

        // Send the notification
        const response = await admin.messaging().send(message);

        console.log(`Receipt reminder sent for expense ${expense._id} to ${userEmail}: ${response}`);

        // Update expense with reminder tracking
        const currentReminderCount = expense.receiptReminderCount || 0;

        await db.collection('expenses').updateOne(
            { _id: expense._id },
            {
                $set: {
                    lastReceiptReminder: new Date(),
                    receiptReminderCount: currentReminderCount + 1
                },
                $push: {
                    auditTrail: {
                        action: 'receipt_reminder_sent',
                        performedBy: 'system@scheduler',
                        timestamp: new Date(),
                        changes: `Receipt reminder #${currentReminderCount + 1} sent`,
                        reason: 'Automated expense receipt reminder'
                    }
                }
            }
        );

        // Log the reminder
        await db.collection('reminderLogs').insertOne({
            type: 'expense_receipt_reminder',
            expenseId: expense._id.toString(),
            userEmail: userEmail,
            organizationId: expense.organizationId,
            reminderNumber: currentReminderCount + 1,
            sentAt: new Date(),
            fcmResponse: response,
            expenseDetails: {
                amount: expense.amount,
                category: expense.category,
                createdAt: expense.createdAt
            }
        });

        return { success: true, messageId: response, reminderNumber: currentReminderCount + 1 };

    } catch (error) {
        console.error(`Error sending receipt reminder for expense ${expense._id}:`, error);
        return { success: false, error: error.message };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

/**
 * Process all expense receipt reminders
 * @param {string} organizationId - Optional, filter by organization
 * @returns {Promise<object>} Processing results
 */
async function processAllExpenseReminders(organizationId = null) {
    console.log(`[${new Date().toISOString()}] Starting expense receipt reminder processing...`);

    const results = {
        totalExpensesChecked: 0,
        remindersSent: 0,
        errors: []
    };

    try {
        const expensesMissingReceipts = await getExpensesMissingReceipts(organizationId);
        results.totalExpensesChecked = expensesMissingReceipts.length;

        console.log(`Found ${expensesMissingReceipts.length} expenses missing receipts`);

        for (const expense of expensesMissingReceipts) {
            try {
                const sendResult = await sendReceiptReminder(expense);

                if (sendResult.success) {
                    results.remindersSent++;
                }
            } catch (expenseError) {
                console.error(`Error processing expense ${expense._id}:`, expenseError);
                results.errors.push({
                    expenseId: expense._id.toString(),
                    error: expenseError.message
                });
            }
        }

        console.log(`[${new Date().toISOString()}] Expense reminder processing completed.`);
        console.log(`- Expenses checked: ${results.totalExpensesChecked}`);
        console.log(`- Reminders sent: ${results.remindersSent}`);

        return results;

    } catch (error) {
        console.error('Error in expense reminder processing:', error);
        throw error;
    }
}

/**
 * Get reminder settings for an organization
 * @param {string} organizationId - Organization ID
 * @returns {Promise<object>} Expense reminder configuration
 */
async function getOrganizationExpenseReminderSettings(organizationId) {
    let client;

    try {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db(DB_NAME);

        const org = await db.collection('organizationsData').findOne({
            _id: new ObjectId(organizationId)
        });

        if (!org || !org.expenseReminders) {
            return DEFAULT_CONFIG;
        }

        return { ...DEFAULT_CONFIG, ...org.expenseReminders };

    } catch (error) {
        console.error('Error getting organization expense reminder settings:', error);
        return DEFAULT_CONFIG;
    } finally {
        if (client) {
            await client.close();
        }
    }
}

/**
 * Update expense reminder settings for an organization
 * @param {string} organizationId - Organization ID
 * @param {object} settings - New settings
 * @returns {Promise<object>} Update result
 */
async function updateOrganizationExpenseReminderSettings(organizationId, settings) {
    let client;

    try {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db(DB_NAME);

        const result = await db.collection('organizationsData').updateOne(
            { _id: new ObjectId(organizationId) },
            {
                $set: {
                    expenseReminders: {
                        enabled: settings.enabled !== false,
                        reminderAfterHours: settings.reminderAfterHours ?? DEFAULT_CONFIG.reminderAfterHours,
                        maxReminders: settings.maxReminders ?? DEFAULT_CONFIG.maxReminders,
                        reminderIntervalHours: settings.reminderIntervalHours ?? DEFAULT_CONFIG.reminderIntervalHours,
                        updatedAt: new Date()
                    }
                }
            }
        );

        return { success: true, modifiedCount: result.modifiedCount };

    } catch (error) {
        console.error('Error updating organization expense reminder settings:', error);
        return { success: false, error: error.message };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

/**
 * Get expense reminder status for a specific expense
 * @param {string} expenseId - Expense ID
 * @returns {Promise<object>} Reminder status
 */
async function getExpenseReminderStatus(expenseId) {
    let client;

    try {
        if (!ObjectId.isValid(expenseId)) {
            throw new Error('Invalid expense ID format');
        }

        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db(DB_NAME);

        const expense = await db.collection('expenses').findOne({
            _id: new ObjectId(expenseId)
        });

        if (!expense) {
            return { success: false, error: 'Expense not found' };
        }

        const hasReceiptAttached = hasReceipt(expense);
        const hoursSinceCreation = Math.floor(
            (Date.now() - new Date(expense.createdAt).getTime()) / (1000 * 60 * 60)
        );

        return {
            success: true,
            data: {
                expenseId: expenseId,
                hasReceipt: hasReceiptAttached,
                createdAt: expense.createdAt,
                hoursSinceCreation: hoursSinceCreation,
                reminderCount: expense.receiptReminderCount || 0,
                lastReminder: expense.lastReceiptReminder || null,
                needsReminder: !hasReceiptAttached && hoursSinceCreation >= DEFAULT_CONFIG.reminderAfterHours,
                maxRemindersReached: (expense.receiptReminderCount || 0) >= DEFAULT_CONFIG.maxReminders
            }
        };

    } catch (error) {
        console.error('Error getting expense reminder status:', error);
        return { success: false, error: error.message };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

module.exports = {
    hasReceipt,
    getExpensesMissingReceipts,
    sendReceiptReminder,
    processAllExpenseReminders,
    getOrganizationExpenseReminderSettings,
    updateOrganizationExpenseReminderSettings,
    getExpenseReminderStatus,
    DEFAULT_CONFIG
};
