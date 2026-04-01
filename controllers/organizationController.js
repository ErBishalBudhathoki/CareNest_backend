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

  sendContactEmailVerification = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required',
      });
    }

    const configuredBaseUrl =
      process.env.BASE_URL ||
      process.env.BACKEND_URL ||
      `${req.protocol}://${req.get('host')}`;

    const result = await organizationService.sendOrganizationContactVerification(
      organizationId,
      configuredBaseUrl,
    );

    if (!result.found) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    if (!result.hasEmail) {
      return res.status(400).json({
        success: false,
        message: 'Set an organization contact email before requesting verification.',
      });
    }

    if (result.alreadyVerified) {
      return res.status(200).json({
        success: true,
        message: 'Organization email is already verified.',
        data: {
          alreadyVerified: true,
          organizationEmail: result.organizationEmail,
        },
      });
    }

    if (result.sendFailed) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send organization verification email.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Organization verification email sent successfully.',
      data: {
        sent: true,
        organizationEmail: result.organizationEmail,
        expiresAt: result.expiresAt,
      },
    });
  });

  verifyContactEmail = catchAsync(async (req, res) => {
    const result = await organizationService.verifyOrganizationContactEmail(
      req.query?.token,
    );

    const success = result.success === true;
    const title = success
      ? 'Organization Email Verified'
      : 'Verification Link Invalid';
    const body = success
      ? `The organization email${result.organizationEmail ? ` ${result.organizationEmail}` : ''} is now verified for ${result.organizationName || 'your organization'}. You can return to the app and refresh the organization details screen.`
      : 'This verification link is invalid or has expired. Request a new organization verification email from the app.';

    return res
      .status(success ? 200 : 400)
      .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f6f3ec; color: #111; margin: 0; padding: 24px; }
      .card { max-width: 640px; margin: 48px auto; background: #fff; border: 3px solid #111; box-shadow: 8px 8px 0 #111; padding: 24px; }
      .badge { display: inline-block; padding: 6px 10px; border: 2px solid #111; font-weight: 800; background: ${success ? '#6be675' : '#ffcc4d'}; }
      h1 { margin: 16px 0 12px; font-size: 28px; }
      p { line-height: 1.6; font-size: 16px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">${success ? 'VERIFIED' : 'ACTION NEEDED'}</div>
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
  </body>
</html>`);
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

  getOrganizationDeletedClients = catchAsync(async (req, res) => {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Organization ID is required"
      });
    }

    const clients = await organizationService.getOrganizationDeletedClients(
      organizationId
    );

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
