const businessService = require('../services/businessService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class BusinessController {
  /**
   * Add business with organization context
   * POST /addBusiness
   */
  addBusiness = catchAsync(async (req, res) => {
    const { 
      businessName, 
      businessEmail, 
      organizationId,
      userEmail 
    } = req.body;
    
    // Validation
    if (!businessName || !businessEmail || !organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Business name, email and organization ID are required"
      });
    }
    
    const businessId = await businessService.addBusiness(req.body);
    
    res.status(201).json({
      success: true,
      statusCode: 201,
      message: "Business added successfully",
      businessId: businessId
    });
  });
  
  /**
   * Get businesses for organization
   * GET /businesses/:organizationId
   */
  getBusinessesByOrganization = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    
    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID is required"
      });
    }
    
    const businesses = await businessService.getBusinessesByOrganization(organizationId);
    
    res.status(200).json({
      success: true,
      statusCode: 200,
      businesses: businesses
    });
  });

  /**
   * Update business details
   * PUT /business/:businessId
   */
  updateBusiness = catchAsync(async (req, res) => {
    const { businessId } = req.params;
    const { organizationId, userEmail, ...updateData } = req.body;

    const result = await businessService.updateBusiness(
      businessId,
      updateData,
      organizationId,
      userEmail
    );

    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });

  /**
   * Soft delete business
   * POST /business/:businessId/delete
   */
  deleteBusiness = catchAsync(async (req, res) => {
    const { businessId } = req.params;
    const { organizationId, userEmail } = req.body;

    const result = await businessService.deleteBusiness(
      businessId,
      organizationId,
      userEmail
    );

    res.status(200).json({
      statusCode: 200,
      ...result
    });
  });
}

module.exports = new BusinessController();
