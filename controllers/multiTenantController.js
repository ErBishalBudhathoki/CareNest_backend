const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const crossOrgService = require('../services/crossOrgService');
const organizationService = require('../services/organizationService');

class MultiTenantController {
  getCrossOrgReport = catchAsync(async (req, res) => {
    const { type, startDate, endDate } = req.query;
    const userId = req.user.userId;

    if (!type) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Report type is required'
      });
    }

    if (type !== 'revenue') {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_REPORT_TYPE',
        message: 'Only revenue reports are currently supported'
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Start date and end date are required'
      });
    }

    const report = await crossOrgService.getCrossOrgRevenue(userId, startDate, endDate);

    logger.business('Cross-org report generated', {
      action: 'CROSS_ORG_REPORT_GENERATED',
      userId,
      reportType: type,
      startDate,
      endDate
    });

    res.status(200).json({
      success: true,
      code: 'REPORT_GENERATED',
      data: report
    });
  });

  addSharedEmployee = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { employeeId, assignmentType, costAllocation, hourlyRate, startDate, endDate } = req.body;

    if (!employeeId || !assignmentType || !startDate) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: employeeId, assignmentType, and startDate are required'
      });
    }

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Organization ID is required'
      });
    }

    const assignment = await organizationService.addSharedEmployee(employeeId, organizationId, {
      assignmentType,
      costAllocation,
      hourlyRate,
      startDate,
      endDate
    });

    logger.business('Shared employee added', {
      action: 'SHARED_EMPLOYEE_ADDED',
      employeeId,
      organizationId,
      assignmentType
    });

    res.status(201).json({
      success: true,
      code: 'SHARED_EMPLOYEE_CREATED',
      message: 'Shared employee added successfully',
      data: assignment
    });
  });
}

module.exports = new MultiTenantController();
