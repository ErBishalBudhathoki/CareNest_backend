const express = require('express');
const router = express.Router();
const accountingService = require('../services/accountingService');
const logger = require('../config/logger');

// Middleware to check auth would go here
// const { verifyToken } = require('../middleware/auth');

/**
 * @route POST /api/accounting/connect
 * @desc Initiate connection to Xero/MYOB
 */
router.post('/connect', async (req, res) => {
    try {
        const { provider, organizationId } = req.body;
        const result = await accountingService.initiateConnection(provider, organizationId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Accounting Connect Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/accounting/callback
 * @desc Handle OAuth callback
 */
router.post('/callback', async (req, res) => {
    try {
        const { provider, code, organizationId } = req.body;
        const result = await accountingService.handleCallback(provider, code, organizationId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Accounting Callback Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/accounting/sync
 * @desc Trigger manual sync of invoices
 */
router.post('/sync', async (req, res) => {
    try {
        const { organizationId, invoiceIds } = req.body;
        const result = await accountingService.syncInvoices(organizationId, invoiceIds);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Accounting Sync Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
