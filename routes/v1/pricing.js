const express = require('express');
const router = express.Router();
const pricingController = require('../../controllers/pricingController');
const { authenticateUser } = require('../../middleware/auth');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');

// Rate limiters
const pricingReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many pricing read requests.' }
});

const pricingWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many pricing write requests.' }
});

const bulkOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many bulk pricing operations.' }
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      statusCode: 400,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Apply authentication to all routes
router.use(authenticateUser);

// Create custom pricing
router.post(
  '/create',
  pricingWriteLimiter,
  [
    body('organizationId').isString().trim().notEmpty(),
    body('userEmail').isEmail().normalizeEmail(),
    body('supportItemNumber').optional().isString().trim(),
    body('supportItemName').optional().isString().trim(),
    body('pricingType').optional().isIn(['fixed', 'hourly', 'daily', 'custom']),
    body('customPrice').optional().isFloat({ min: 0 }),
    body('multiplier').optional().isFloat({ min: 0 }),
    body('clientId').optional().isString().trim(),
    body('clientSpecific').optional().isBoolean(),
    body('ndisCompliant').optional().isBoolean(),
    body('exceedsNdisCap').optional().isBoolean(),
    body('effectiveDate').optional().isISO8601(),
    body('expiryDate').optional().isISO8601()
  ],
  handleValidationErrors,
  pricingController.createCustomPricing
);

// Get organization pricing
router.get(
  '/organization/:organizationId',
  pricingReadLimiter,
  [
    param('organizationId').isString().trim().notEmpty(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString().trim(),
    query('clientSpecific').optional().isBoolean(),
    query('approvalStatus').optional().isIn(['pending', 'approved', 'rejected']),
    query('sortBy').optional().isString().trim(),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  handleValidationErrors,
  pricingController.getOrganizationPricing
);

// Get pricing by ID
router.get(
  '/:id',
  pricingReadLimiter,
  [
    param('id').isString().trim().notEmpty()
  ],
  handleValidationErrors,
  pricingController.getPricingById
);

// Update custom pricing
router.put(
  '/:id',
  pricingWriteLimiter,
  [
    param('id').isString().trim().notEmpty(),
    body('userEmail').isEmail().normalizeEmail(),
    body('supportItemName').optional().isString().trim(),
    body('pricingType').optional().isIn(['fixed', 'hourly', 'daily', 'custom']),
    body('customPrice').optional().isFloat({ min: 0 }),
    body('multiplier').optional().isFloat({ min: 0 }),
    body('clientId').optional().isString().trim(),
    body('clientSpecific').optional().isBoolean(),
    body('ndisCompliant').optional().isBoolean(),
    body('exceedsNdisCap').optional().isBoolean(),
    body('effectiveDate').optional().isISO8601(),
    body('expiryDate').optional().isISO8601()
  ],
  handleValidationErrors,
  pricingController.updateCustomPricing
);

// Delete custom pricing
router.delete(
  '/:id',
  pricingWriteLimiter,
  [
    param('id').isString().trim().notEmpty(),
    body('userEmail').isEmail().normalizeEmail()
  ],
  handleValidationErrors,
  pricingController.deleteCustomPricing
);

// Update pricing approval status
router.put(
  '/:id/approval',
  pricingWriteLimiter,
  [
    param('id').isString().trim().notEmpty(),
    body('approvalStatus').isIn(['pending', 'approved', 'rejected']),
    body('userEmail').isEmail().normalizeEmail()
  ],
  handleValidationErrors,
  pricingController.updatePricingApproval
);

// Pricing lookup with path params
router.get(
  '/lookup/:organizationId/:supportItemNumber',
  pricingReadLimiter,
  [
    param('organizationId').isString().trim().notEmpty(),
    param('supportItemNumber').isString().trim().notEmpty(),
    query('clientId').optional().isString().trim()
  ],
  handleValidationErrors,
  pricingController.getPricingLookup
);

// Pricing lookup with query params
router.get(
  '/lookup',
  pricingReadLimiter,
  [
    query('organizationId').isString().trim().notEmpty(),
    query('supportItemNumber').isString().trim().notEmpty(),
    query('clientId').optional().isString().trim()
  ],
  handleValidationErrors,
  pricingController.getPricingLookup
);

// Bulk pricing lookup
router.post(
  '/bulk-lookup',
  bulkOperationLimiter,
  [
    body('organizationId').isString().trim().notEmpty(),
    body('supportItemNumbers').isArray({ min: 1 }),
    body('supportItemNumbers.*').isString().trim(),
    body('clientId').optional().isString().trim()
  ],
  handleValidationErrors,
  pricingController.getBulkPricingLookup
);

// Bulk import pricing
router.post(
  '/bulk-import',
  bulkOperationLimiter,
  [
    body('organizationId').isString().trim().notEmpty(),
    body('pricingRecords').isArray({ min: 1 }),
    body('userEmail').isEmail().normalizeEmail(),
    body('importNotes').optional().isString().trim()
  ],
  handleValidationErrors,
  pricingController.bulkImportPricing
);

// Get fallback base rate
router.get(
  '/fallback-base-rate/:organizationId',
  pricingReadLimiter,
  [
    param('organizationId').isString().trim().notEmpty()
  ],
  handleValidationErrors,
  pricingController.getFallbackBaseRate
);

// Set fallback base rate
router.put(
  '/fallback-base-rate/:organizationId',
  pricingWriteLimiter,
  [
    param('organizationId').isString().trim().notEmpty(),
    body('fallbackBaseRate').isFloat({ min: 0 }),
    body('userEmail').isEmail().normalizeEmail()
  ],
  handleValidationErrors,
  pricingController.setFallbackBaseRate
);

// Get standard price for NDIS item
router.get(
  '/standard-price/:ndisItemNumber',
  pricingReadLimiter,
  [
    param('ndisItemNumber').isString().trim().notEmpty(),
    query('clientId').optional().isString().trim()
  ],
  handleValidationErrors,
  pricingController.getStandardPrice
);

module.exports = router;
