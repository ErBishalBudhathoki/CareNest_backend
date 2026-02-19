const employeeTrackingService = require('../services/employeeTrackingService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class EmployeeTrackingController {
  /**
   * Get comprehensive employee tracking data for an organization
   * GET /api/employee-tracking/:organizationId
   */
  static getEmployeeTrackingData = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    
    // Validate organization ID
    if (!organizationId || organizationId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }
    
    logger.debug('Getting employee tracking data', {
      organizationId
    });
    
    // Get employee tracking data from service
    const trackingData = await employeeTrackingService.getEmployeeTrackingData(organizationId);
    
    logger.debug('Employee tracking data retrieved', {
      organizationId,
      totalEmployees: trackingData.totalEmployees,
      currentlyWorking: trackingData.currentlyWorking.length,
      notCurrentlyWorking: trackingData.notCurrentlyWorking.length
    });
    
    res.json({
      success: true,
      data: trackingData
    });
  });
}

module.exports = EmployeeTrackingController;
