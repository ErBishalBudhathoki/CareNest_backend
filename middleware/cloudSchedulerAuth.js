/**
 * Cloud Scheduler Authentication Middleware
 * Verifies that requests to scheduler endpoints are from Google Cloud Scheduler
 * 
 * Security:
 * - Checks X-CloudScheduler header
 * - Validates OIDC token (in production)
 * - Allows requests in development/test environments
 */

const logger = require('../config/logger');

/**
 * Middleware to authenticate Cloud Scheduler requests
 */
const authenticateCloudScheduler = (req, res, next) => {
    // In development/test, allow requests without authentication
    if (process.env.NODE_ENV !== 'production') {
        logger.info('Cloud Scheduler auth: Skipping in non-production environment');
        return next();
    }

    // Check for Cloud Scheduler header
    const cloudSchedulerHeader = req.get('X-CloudScheduler');
    if (!cloudSchedulerHeader) {
        logger.warn('Cloud Scheduler auth: Missing X-CloudScheduler header');
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Invalid request source'
        });
    }

    // In production, Cloud Scheduler uses OIDC tokens in the Authorization header
    // The token is automatically validated by Cloud Functions/Cloud Run
    // Additional validation can be done here if needed

    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn('Cloud Scheduler auth: Missing or invalid Authorization header');
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Missing authentication'
        });
    }

    // If running on Cloud Run/Cloud Functions, the JWT is already validated by the platform
    // For additional security, you could verify the token's claims here
    // using Google's OAuth2 library

    logger.info('Cloud Scheduler auth: Request authenticated');
    next();
};

/**
 * Middleware to log scheduler execution
 */
const logSchedulerExecution = (jobName) => {
    return (req, res, next) => {
        const startTime = Date.now();

        logger.info(`Cloud Scheduler job started: ${jobName}`, {
            timestamp: new Date().toISOString(),
            jobName,
            source: req.get('X-CloudScheduler') || 'unknown'
        });

        // Log response when finished
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            logger.info(`Cloud Scheduler job completed: ${jobName}`, {
                timestamp: new Date().toISOString(),
                jobName,
                statusCode: res.statusCode,
                duration: `${duration}ms`
            });
        });

        next();
    };
};

module.exports = {
    authenticateCloudScheduler,
    logSchedulerExecution
};
