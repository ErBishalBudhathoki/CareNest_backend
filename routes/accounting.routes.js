const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser } = require('../middleware/auth');
const accountingService = require('../services/accountingService');
const logger = require('../config/logger');

// Rate limiting configurations
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const connectValidation = [
  body('provider').isIn(['xero', 'myob', 'quickbooks']).withMessage('Valid provider is required (xero, myob, quickbooks)'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const callbackValidation = [
  body('provider').isIn(['xero', 'myob', 'quickbooks']).withMessage('Valid provider is required'),
  body('code').trim().notEmpty().withMessage('Authorization code is required'),
  body('organizationId').isMongoId().withMessage('Valid organization ID is required')
];

const syncValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('invoiceIds').optional().isArray().withMessage('Invoice IDs must be an array'),
  body('invoiceIds.*').optional().isMongoId().withMessage('Each invoice ID must be valid')
];

// Apply authentication to all routes
router.use(authenticateUser);

/**
 * @route POST /api/accounting/connect
 * @desc Initiate connection to Xero/MYOB
 */
router.post('/connect', standardLimiter, connectValidation, handleValidationErrors, async (req, res) => {
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
router.post('/callback', standardLimiter, callbackValidation, handleValidationErrors, async (req, res) => {
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
router.post('/sync', strictLimiter, syncValidation, handleValidationErrors, async (req, res) => {
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
