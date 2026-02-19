const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const settingsController = require('../controllers/settingsController');
const { authenticateUser } = require('../middleware/auth');

const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many settings requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

router.use(authenticateUser);

const settingsValidation = [
    body('organizationId').optional().isString().trim(),
    body('autoUpdatePricing').optional().isBoolean(),
    body('enablePriceValidation').optional().isBoolean(),
    body('requireApprovalForChanges').optional().isBoolean(),
    body('enableBulkOperations').optional().isBoolean(),
    body('enablePriceHistory').optional().isBoolean(),
    body('enableNotifications').optional().isBoolean(),
    
    body('defaultCurrency').optional().isString().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 chars'),
    body('pricingModel').optional().isString().isLength({ max: 100 }),
    body('roundingMethod').optional().isString().isLength({ max: 100 }),
    body('taxCalculation').optional().isIn(['GST Inclusive', 'GST Exclusive']),
    
    body('fallbackBaseRate').optional().isFloat({ min: 0 }),
    body('defaultMarkup').optional().isFloat({ min: 0, max: 100 }),
    body('maxPriceVariation').optional().isFloat({ min: 0, max: 100 }),
    body('priceHistoryRetention').optional().isInt({ min: 1, max: 3650 }),
    body('bulkOperationLimit').optional().isInt({ min: 1, max: 10000 })
];

const orgIdQueryValidation = [
    query('organizationId').optional().isString().trim()
];

/**
 * @route GET /api/settings/general
 * @desc Get General Settings
 */
router.get(
    '/general', 
    settingsLimiter,
    orgIdQueryValidation,
    handleValidationErrors,
    settingsController.getGeneralSettings
);

/**
 * @route PUT /api/settings/general
 * @desc Update General Settings
 */
router.put(
    '/general', 
    strictLimiter,
    settingsValidation,
    handleValidationErrors,
    settingsController.updateGeneralSettings
);

module.exports = router;
