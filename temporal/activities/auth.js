'use strict';

const emailService = require('../../services/emailService');
const logger = require('../../utils/logger').createLogger('AuthActivities');

/**
 * Activity to send email verification OTP
 */
async function sendVerificationEmailActivity({ email, firstName, otp }) {
    try {
        logger.info(`[Temporal Activity] Sending verification email to ${email}`);
        const result = await emailService.sendVerificationEmail(email, firstName, otp);
        if (!result) {
            throw new Error('Failed to send verification email (Listmonk returned empty)');
        }
        return { success: true, result };
    } catch (error) {
        logger.error('sendVerificationEmailActivity failed', { email, error: error.message });
        // Throw to trigger Temporal retry
        throw error;
    }
}

/**
 * Activity to send password reset OTP
 */
async function sendPasswordResetEmailActivity({ email, otp }) {
    try {
        logger.info(`[Temporal Activity] Sending password reset email to ${email}`);
        const result = await emailService.sendPasswordResetEmail(email, otp);
        if (!result) {
            throw new Error('Failed to send password reset email (Listmonk returned empty)');
        }
        return { success: true, result };
    } catch (error) {
        logger.error('sendPasswordResetEmailActivity failed', { email, error: error.message });
        throw error;
    }
}

/**
 * Activity to send password change notification
 */
async function sendPasswordChangeNotificationActivity({ email, firstName }) {
    try {
        logger.info(`[Temporal Activity] Sending password change notification to ${email}`);
        const result = await emailService.sendPasswordChangeNotification(email, firstName);
        if (!result) {
            throw new Error('Failed to send password change notification (Listmonk returned empty)');
        }
        return { success: true, result };
    } catch (error) {
        logger.error('sendPasswordChangeNotificationActivity failed', { email, error: error.message });
        throw error;
    }
}

module.exports = {
    sendVerificationEmailActivity,
    sendPasswordResetEmailActivity,
    sendPasswordChangeNotificationActivity
};

/**
 * Activity to send a generic HTML email (used for Client Activation, etc.)
 */
async function sendGenericEmailActivity({ email, subject, html }) {
    try {
        logger.info(`[Temporal Activity] Sending generic email to ${email} - ${subject}`);
        const result = await emailService.sendEmail(email, subject, html);
        if (!result) {
            throw new Error('Failed to send generic email (Listmonk returned empty)');
        }
        return { success: true, result };
    } catch (error) {
        logger.error('sendGenericEmailActivity failed', { email, subject, error: error.message });
        throw error;
    }
}

module.exports.sendGenericEmailActivity = sendGenericEmailActivity;
