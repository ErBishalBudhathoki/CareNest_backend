/**
 * Dunning Scheduler
 * Cron job to run dunning service daily
 * 
 * @file backend/cron/dunningScheduler.js
 */

const cron = require('node-cron');
const dunningService = require('../services/dunningService');
const logger = require('../config/logger');

// Run every day at 9:00 AM
const scheduleDunning = () => {
    cron.schedule('0 9 * * *', async () => {
        logger.info('Starting daily dunning process...');
        try {
            const result = await dunningService.processOverdueInvoices();
            logger.info('Daily dunning process completed', result);
        } catch (error) {
            logger.error('Daily dunning process failed', error);
        }
    });

    logger.info('Dunning scheduler initialized (0 9 * * *)');
};

/**
 * Manual trigger for Cloud Scheduler
 * Processes overdue invoices for dunning
 */
const processDunning = async () => {
    logger.info('Starting dunning process (triggered by Cloud Scheduler)...');
    try {
        const result = await dunningService.processOverdueInvoices();
        logger.info('Dunning process completed', result);
        return result;
    } catch (error) {
        logger.error('Dunning process failed', error);
        throw error;
    }
};

module.exports = {
    scheduleDunning,
    processDunning
};
