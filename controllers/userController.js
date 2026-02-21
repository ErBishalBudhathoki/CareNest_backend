const userService = require('../services/userService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class UserController {
  /**
   * Get all users
   * GET /getUsers/
   */
  getAllUsers = catchAsync(async (req, res) => {
    // Security: Filter by authenticated user's organization
    // Only superadmins might be allowed to see all, but for now we restrict to org
    const organizationId = req.user.organizationId;

    // If no organization ID in token (shouldn't happen for valid users), return empty or error
    if (!organizationId) {
      // Check if superadmin, maybe allow? For now, safer to return empty or specific error
      // Assuming standard user flow
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Organization context required'
      });
    }

    const users = await userService.getAllUsers(organizationId);

    logger.business('Retrieved all users', {
      action: 'user_list_all',
      count: users.length,
      organizationId
    });

    res.status(200).json({
      success: true,
      code: 'USERS_RETRIEVED',
      users
    });
  });

  /**
   * Get all employees for a specific organization
   * GET /organization/:organizationId/employees
   */
  getOrganizationEmployees = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Organization ID is required'
      });
    }

    const employees = await userService.getOrganizationEmployees(organizationId);

    if (employees.length === 0) {
      return res.status(200).json({
        success: true,
        code: 'NO_EMPLOYEES_FOUND',
        message: 'No users (employees) were found for this organization.',
        employees: []
      });
    }

    logger.business('Retrieved organization employees', {
      action: 'user_list_organization',
      organizationId,
      count: employees.length
    });

    res.status(200).json({
      success: true,
      code: 'EMPLOYEES_RETRIEVED',
      employees
    });
  });

  /**
   * Fix client organizationId for existing records
   * POST /fixClientOrganizationId
   */
  fixClientOrganizationId = catchAsync(async (req, res) => {
    const { userEmail, organizationId } = req.body;

    if (!userEmail || !organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'userEmail and organizationId are required'
      });
    }

    const result = await userService.fixClientOrganizationId(userEmail, organizationId);

    logger.business('Fixed client organizationId', {
      action: 'user_fix_org_id',
      userEmail,
      organizationId,
      clientsUpdated: result.clientsUpdated,
      assignmentsUpdated: result.assignmentsUpdated
    });

    res.status(200).json({
      success: true,
      code: 'ORGANIZATION_ID_FIXED',
      message: 'Organization ID fixed successfully',
      clientsUpdated: result.clientsUpdated,
      assignmentsUpdated: result.assignmentsUpdated
    });
  });
}

module.exports = new UserController();
