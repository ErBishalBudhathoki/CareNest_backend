'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const {
    sendVerificationEmailActivity,
    sendPasswordResetEmailActivity,
    sendPasswordChangeNotificationActivity,
    sendGenericEmailActivity
} = proxyActivities({
    startToCloseTimeout: '1 minute',
    retry: {
        initialInterval: '10 seconds',
        maximumInterval: '10 minutes',
        backoffCoefficient: 2,
        maximumAttempts: 10,
    },
});

/**
 * Workflow to handle authentication notifications
 * @param {Object} params
 * @param {string} params.type - VERIFICATION, PASSWORD_RESET, PASSWORD_CHANGED, GENERIC
 * @param {Object} params.data - { email, firstName, otp, subject, html }
 */
async function authNotificationWorkflow(params) {
    const { type, data } = params;

    switch (type) {
        case 'VERIFICATION':
            return await sendVerificationEmailActivity(data);
        case 'PASSWORD_RESET':
            return await sendPasswordResetEmailActivity(data);
        case 'PASSWORD_CHANGED':
            return await sendPasswordChangeNotificationActivity(data);
        case 'GENERIC':
            return await sendGenericEmailActivity(data);
        default:
            throw new Error(`Unknown auth notification type: ${type}`);
    }
}

module.exports = {
    authNotificationWorkflow
};
