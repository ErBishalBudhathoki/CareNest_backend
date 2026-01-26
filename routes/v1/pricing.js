const express = require('express');
const router = express.Router();
const pricingController = require('../../controllers/pricingController');

// Create custom pricing
router.post('/create', pricingController.createCustomPricing);

// Get organization pricing
router.get('/organization/:organizationId', pricingController.getOrganizationPricing);

// Get/Update/Delete specific pricing
router.get('/:id', pricingController.getPricingById);
router.put('/:id', pricingController.updateCustomPricing);
router.delete('/:id', pricingController.deleteCustomPricing);

// Approval
router.put('/:id/approval', pricingController.updatePricingApproval);

// Lookup
router.get('/lookup/:organizationId/:supportItemNumber', pricingController.getPricingLookup);
router.get('/lookup', pricingController.getPricingLookup); // Support query params version too

// Bulk operations
router.post('/bulk-lookup', pricingController.getBulkPricingLookup);
router.post('/bulk-import', pricingController.bulkImportPricing);

// Fallback Base Rate
router.get('/fallback-base-rate/:organizationId', pricingController.getFallbackBaseRate);
router.put('/fallback-base-rate/:organizationId', pricingController.setFallbackBaseRate);

module.exports = router;
