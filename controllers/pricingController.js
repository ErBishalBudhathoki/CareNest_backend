const pricingService = require('../services/pricingService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class PricingController {
  /**
   * Create custom pricing
   * POST /api/pricing
   */
  createCustomPricing = catchAsync(async (req, res) => {
    const { organizationId, userEmail } = req.body;

    // Validate required fields
    if (!organizationId || !userEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: 'organizationId and userEmail are required'
      });
    }

    // Validate user authorization
    const isAuthorized = await pricingService.validateUserAuthorization(userEmail, organizationId);
    if (!isAuthorized) {
      return res.status(403).json({
        statusCode: 403,
        message: 'User not authorized for this organization'
      });
    }

    const pricingData = {
      organizationId,
      supportItemNumber: req.body.supportItemNumber,
      supportItemName: req.body.supportItemName,
      pricingType: req.body.pricingType,
      customPrice: req.body.customPrice,
      multiplier: req.body.multiplier,
      clientId: req.body.clientId,
      clientSpecific: req.body.clientSpecific,
      ndisCompliant: req.body.ndisCompliant,
      exceedsNdisCap: req.body.exceedsNdisCap,
      effectiveDate: req.body.effectiveDate,
      expiryDate: req.body.expiryDate
    };

    const result = await pricingService.createCustomPricing(pricingData, userEmail);

    logger.business('Custom Pricing Created', {
      event: 'custom_pricing_created',
      organizationId,
      userEmail,
      supportItemNumber: pricingData.supportItemNumber,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      statusCode: 201,
      message: 'Custom pricing created successfully',
      data: result
    });
  });

  /**
   * Get organization pricing
   * GET /api/pricing/organization/:organizationId
   */
  getOrganizationPricing = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const {
      page,
      limit,
      search,
      clientSpecific,
      approvalStatus,
      sortBy,
      sortOrder
    } = req.query;

    const options = {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      search,
      clientSpecific: clientSpecific !== undefined ? clientSpecific === 'true' : undefined,
      approvalStatus,
      sortBy,
      sortOrder
    };

    const result = await pricingService.getOrganizationPricing(organizationId, options);

    res.status(200).json({
      statusCode: 200,
      data: result.pricing,
      pagination: result.pagination
    });
  });

  /**
   * Get pricing by ID
   * GET /api/pricing/:id
   */
  getPricingById = catchAsync(async (req, res) => {
    const { id } = req.params;

    const pricing = await pricingService.getPricingById(id);

    if (!pricing) {
      return res.status(404).json({
        statusCode: 404,
        message: 'Pricing record not found'
      });
    }

    res.status(200).json({
      statusCode: 200,
      data: pricing
    });
  });

  /**
   * Update custom pricing
   * PUT /api/pricing/:id
   */
  updateCustomPricing = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: 'userEmail is required'
      });
    }

    const updateData = {
      supportItemName: req.body.supportItemName,
      pricingType: req.body.pricingType,
      customPrice: req.body.customPrice,
      multiplier: req.body.multiplier,
      clientId: req.body.clientId,
      clientSpecific: req.body.clientSpecific,
      ndisCompliant: req.body.ndisCompliant,
      exceedsNdisCap: req.body.exceedsNdisCap,
      effectiveDate: req.body.effectiveDate,
      expiryDate: req.body.expiryDate
    };

    const result = await pricingService.updateCustomPricing(id, updateData, userEmail);

    logger.business('Custom Pricing Updated', {
      event: 'custom_pricing_updated',
      pricingId: id,
      userEmail,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Custom pricing updated successfully',
      data: result
    });
  });

  /**
   * Delete custom pricing
   * DELETE /api/pricing/:id
   */
  deleteCustomPricing = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: 'userEmail is required'
      });
    }

    const success = await pricingService.deleteCustomPricing(id, userEmail);

    if (!success) {
      return res.status(404).json({
        statusCode: 404,
        message: 'Pricing record not found or already deleted'
      });
    }

    logger.business('Custom Pricing Deleted', {
      event: 'custom_pricing_deleted',
      pricingId: id,
      userEmail,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Custom pricing deleted successfully'
    });
  });

  /**
   * Update pricing approval status
   * PUT /api/pricing/:id/approval
   */
  updatePricingApproval = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { approvalStatus, userEmail } = req.body;

    if (!approvalStatus || !userEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: 'approvalStatus and userEmail are required'
      });
    }

    if (!['pending', 'approved', 'rejected'].includes(approvalStatus)) {
      return res.status(400).json({
        statusCode: 400,
        message: 'Invalid approval status. Must be pending, approved, or rejected'
      });
    }

    const result = await pricingService.updatePricingApproval(id, approvalStatus, userEmail);

    logger.business('Pricing Approval Updated', {
      event: 'pricing_approval_updated',
      pricingId: id,
      approvalStatus,
      userEmail,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Pricing approval status updated successfully',
      data: result
    });
  });

  /**
   * Get standard price for an NDIS support item
   * GET /standard-price/:ndisItemNumber
   */
  getStandardPrice = catchAsync(async (req, res) => {
    const { ndisItemNumber } = req.params;
    const { clientId } = req.query || {};

    if (!ndisItemNumber) {
      return res.status(400).json({
        success: false,
        message: 'ndisItemNumber is required'
      });
    }

    const result = await pricingService.getStandardPrice(ndisItemNumber, clientId || null);

    // Do not inject synthetic 0 fallback; surface null when unavailable
    return res.status(200).json({
      success: true,
      price: result?.price ?? null,
      hasStandardPrice: result?.price != null,
      data: result,
    });
  });

  /**
   * Get pricing lookup for a single item
   * GET /api/pricing/lookup
   */
  getPricingLookup = catchAsync(async (req, res) => {
    // Support both query params and path params for backward compatibility
    const organizationId = req.params.organizationId || req.query.organizationId;
    const supportItemNumber = req.params.supportItemNumber || req.query.supportItemNumber;
    const { clientId } = req.query;

    if (!organizationId || !supportItemNumber) {
      return res.status(400).json({
        statusCode: 400,
        message: 'organizationId and supportItemNumber are required'
      });
    }

    const result = await pricingService.getPricingLookup(organizationId, supportItemNumber, clientId);

    if (!result) {
      return res.status(404).json({
        statusCode: 404,
        message: 'No pricing found for this support item'
      });
    }

    res.status(200).json({
      statusCode: 200,
      data: result
    });
  });

  /**
   * Get bulk pricing lookup
   * POST /api/pricing/bulk-lookup
   */
  getBulkPricingLookup = catchAsync(async (req, res) => {
    const { organizationId, supportItemNumbers, clientId } = req.body;

    if (!organizationId || !supportItemNumbers || !Array.isArray(supportItemNumbers)) {
      return res.status(400).json({
        statusCode: 400,
        message: 'organizationId and supportItemNumbers array are required'
      });
    }

    const result = await pricingService.getBulkPricingLookup(organizationId, supportItemNumbers, clientId);

    res.status(200).json({
      statusCode: 200,
      data: result.data,
      metadata: result.metadata
    });
  });

  /**
   * Bulk import pricing
   * POST /api/pricing/bulk-import
   */
  bulkImportPricing = catchAsync(async (req, res) => {
    const { organizationId, pricingRecords, userEmail, importNotes } = req.body;

    if (!organizationId || !pricingRecords || !Array.isArray(pricingRecords) || !userEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: 'organizationId, pricingRecords array, and userEmail are required'
      });
    }

    // Validate user authorization
    const isAuthorized = await pricingService.validateUserAuthorization(userEmail, organizationId);
    if (!isAuthorized) {
      return res.status(403).json({
        statusCode: 403,
        message: 'User not authorized for this organization'
      });
    }

    const results = await pricingService.bulkImportPricing(organizationId, pricingRecords, userEmail, importNotes);

    logger.business('Bulk Pricing Import', {
      event: 'bulk_pricing_import',
      organizationId,
      userEmail,
      recordCount: pricingRecords.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Bulk import completed',
      results
    });
  });

  /**
   * Get organization fallback base rate
   * GET /api/pricing/fallback-base-rate/:organizationId
   */
  getFallbackBaseRate = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: 'organizationId is required'
      });
    }

    const result = await pricingService.getFallbackBaseRate(organizationId);

    res.status(200).json({
      statusCode: 200,
      data: result
    });
  });

  /**
   * Set organization fallback base rate
   * PUT /api/pricing/fallback-base-rate/:organizationId
   */
  setFallbackBaseRate = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { fallbackBaseRate, userEmail } = req.body;

    if (!organizationId || fallbackBaseRate === undefined || !userEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: 'organizationId, fallbackBaseRate, and userEmail are required'
      });
    }

    // Validate authorization
    const isAuthorized = await pricingService.validateUserAuthorization(userEmail, organizationId);
    if (!isAuthorized) {
      return res.status(403).json({
        statusCode: 403,
        message: 'User not authorized for this organization'
      });
    }

    const result = await pricingService.setFallbackBaseRate(organizationId, fallbackBaseRate, userEmail);

    logger.business('Fallback Base Rate Updated', {
      event: 'fallback_base_rate_updated',
      organizationId,
      fallbackBaseRate,
      userEmail,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Fallback base rate updated',
      data: result
    });
  });
}

module.exports = new PricingController();
