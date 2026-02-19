const organizationService = require('../services/organizationService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class OrganizationController {
  createOrganization = catchAsync(async (req, res) => {
    const { organizationName, ownerEmail } = req.body;

    if (!organizationName || !ownerEmail) {
      return res.status(400).json({
        message: "Organization name and owner email are required"
      });
    }

    const result = await organizationService.createOrganization({
      organizationName,
      ownerEmail
    });

    res.status(200).json({
      message: "Organization created successfully",
      ...result
    });
  });

  createOrganizationLegacy = catchAsync(async (req, res) => {
    const { organizationName, ownerFirstName, ownerLastName, ownerEmail } = req.body;

    if (!organizationName || !ownerEmail) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization name and owner email are required"
      });
    }

    const result = await organizationService.createOrganization({
      organizationName,
      ownerEmail,
      ownerFirstName,
      ownerLastName
    });

    res.status(200).json({
      statusCode: 200,
      message: "Organization created successfully",
      ...result
    });
  });

  verifyOrganizationCode = catchAsync(async (req, res) => {
    const { organizationCode } = req.body;

    if (!organizationCode) {
      return res.status(400).json({
        message: "Organization code is required"
      });
    }

    const organization = await organizationService.verifyOrganizationCode(organizationCode);

    if (organization) {
      res.status(200).json({
        message: "Organization code is valid",
        ...organization
      });
    } else {
      res.status(404).json({
        message: "Invalid organization code"
      });
    }
  });

  verifyOrganizationCodeGet = catchAsync(async (req, res) => {
    const { organizationCode } = req.params;

    if (!organizationCode) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "Organization code is required"
      });
    }

    const organization = await organizationService.verifyOrganizationCode(organizationCode);

    if (organization) {
      res.status(200).json({
        success: true,
        statusCode: 200,
        message: "Organization code verified",
        organizationId: organization.organizationId,
        organizationName: organization.organizationName
      });
    } else {
      res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Invalid organization code"
      });
    }
  });

  verifyOrganizationCodeLegacy = catchAsync(async (req, res) => {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "Organization code is required"
      });
    }

    const organization = await organizationService.verifyOrganizationCode(code);

    if (organization) {
      res.status(200).json({
        success: true,
        statusCode: 200,
        message: "Organization code verified",
        organizationId: organization.organizationId,
        organizationName: organization.organizationName
      });
    } else {
      res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Invalid organization code"
      });
    }
  });

  getOrganizationById = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        message: "Organization ID is required"
      });
    }

    const organization = await organizationService.getOrganizationById(organizationId);

    if (organization) {
      if (organization.logoUrl && !organization.logoUrl.startsWith('http')) {
        const protocol = req.protocol;
        const host = req.get('host');
        const cleanPath = organization.logoUrl.startsWith('/') ? organization.logoUrl : `/${organization.logoUrl}`;
        organization.logoUrl = `${protocol}://${host}${cleanPath}`;
      }

      res.status(200).json({
        message: "Organization details fetched successfully",
        organization
      });
    } else {
      res.status(404).json({
        message: "Organization not found"
      });
    }
  });

  updateOrganizationDetails = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const updates = req.body;

    if (!organizationId) {
      return res.status(400).json({
        message: "Organization ID is required"
      });
    }

    if (updates.logoUrl) {
      const match = updates.logoUrl.match(/(\/uploads\/[^?#]*)/);
      if (match) {
        updates.logoUrl = match[1];
      }
    }

    const result = await organizationService.updateOrganizationDetails(organizationId, updates);

    if (!result.found) {
      return res.status(404).json({
        message: "Organization not found",
        success: false
      });
    }

    res.status(200).json({
      message: result.modified ? "Organization details updated successfully" : "No changes detected",
      success: true
    });
  });

  getOrganizationMembers = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID is required"
      });
    }

    const members = await organizationService.getOrganizationMembers(organizationId);

    res.status(200).json({
      statusCode: 200,
      members: members
    });
  });

  getOrganizationBusinesses = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID is required"
      });
    }

    const businesses = await organizationService.getOrganizationBusinesses(organizationId);

    res.status(200).json({
      statusCode: 200,
      businesses: businesses
    });
  });

  getOrganizationClients = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID is required"
      });
    }

    const clients = await organizationService.getOrganizationClients(organizationId);

    res.status(200).json({
      statusCode: 200,
      clients: clients
    });
  });

  getOrganizationEmployees = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID is required"
      });
    }

    const employees = await organizationService.getOrganizationEmployees(organizationId);

    res.status(200).json({
      statusCode: 200,
      employees: employees
    });
  });

  switchOrganization = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    // AuthMiddleware sets req.user.userId
    const userId = req.user.userId || req.user.id; 

    const result = await organizationService.switchOrganization(userId, organizationId);

    res.status(200).json({
      message: "Switched organization successfully",
      data: result
    });
  });

  getBranding = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const branding = await organizationService.getOrganizationBranding(organizationId);
    res.status(200).json({
      data: branding
    });
  });

  updateBranding = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const branding = await organizationService.updateOrganizationBranding(organizationId, req.body);
    res.status(200).json({
      message: "Branding updated successfully",
      data: branding
    });
  });

  getMyOrganizations = catchAsync(async (req, res) => {
    // AuthMiddleware sets req.user.userId
    const userId = req.user.userId || req.user.id; 
    const organizations = await organizationService.getUserOrganizations(userId);
    res.status(200).json({
      data: organizations
    });
  });

  /**
   * Complete organization setup
   * POST /api/organization/:organizationId/complete-setup
   * Allows admin to update organization details after registration
   */
  completeSetup = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const {
      logoUrl,
      abn,
      address,
      contactDetails,
      bankDetails,
      ndisRegistration,
      timesheetReminders,
      defaultPricingSettings
    } = req.body;

    // Verify user has permission (must be owner or admin)
    const userId = req.user?.userId || req.user?.id;
    const userEmail = req.user?.email;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Update organization details
    const result = await organizationService.updateOrganizationSetup(organizationId, {
      logoUrl,
      abn,
      address,
      contactDetails,
      bankDetails,
      ndisRegistration,
      timesheetReminders,
      defaultPricingSettings,
      updatedBy: userEmail
    });

    logger.info('Organization setup completed', {
      organizationId,
      updatedBy: userEmail,
      fields: Object.keys(req.body)
    });

    res.status(200).json({
      success: true,
      message: 'Organization setup completed successfully',
      data: result
    });
  });
}

module.exports = new OrganizationController();
