const crypto = require('crypto');
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const User = require('../models/User');
const Business = require('../models/Business');
const Client = require('../models/Client');
const UserOrganization = require('../models/UserOrganization');
const OrganizationBranding = require('../models/OrganizationBranding');
const SharedEmployeeAssignment = require('../models/SharedEmployeeAssignment');
const { generateOrganizationCode } = require('../utils/cryptoHelpers');
const cacheService = require('./cacheService');
const emailService = require('./emailService');
const {
  backfillLegacyOrganizationCodes,
  getCanonicalOrganizationCode,
  normalizeOrganizationCode,
} = require('../utils/organizationCodeUtils');
const InputValidator = require('../utils/inputValidator');

class OrganizationService {
  _normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  _buildOrganizationCacheKey(organizationId) {
    return `org:v2:${organizationId}`;
  }

  _hashVerificationToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  _buildSafeContactDetails(organization) {
    const contactDetails = organization.contactDetails || {};
    return {
      phone: contactDetails.phone,
      email: contactDetails.email,
      website: contactDetails.website,
      emailVerified: Boolean(contactDetails.emailVerified),
      emailVerificationSentAt: contactDetails.emailVerificationSentAt || null,
      emailVerifiedAt: contactDetails.emailVerifiedAt || null,
    };
  }

  async _computeVerificationMeta(organization) {
    const ownerEmail = this._normalizeEmail(organization.ownerEmail);
    const ownerUser = ownerEmail
      ? await User.findOne({ email: ownerEmail }).select('emailVerified')
      : null;
    const ownerEmailVerified = Boolean(ownerUser?.emailVerified);

    const safeContactDetails = this._buildSafeContactDetails(organization);
    const organizationEmail = this._normalizeEmail(safeContactDetails.email);
    const organizationEmailVerified = Boolean(safeContactDetails.emailVerified);
    const isVerified = organizationEmailVerified;
    const verificationSource = organizationEmailVerified
      ? 'organization_email'
      : 'pending';
    const verificationEmail = organizationEmail || null;

    return {
      ownerEmailVerified,
      organizationEmail: organizationEmail || null,
      organizationEmailVerified,
      isVerified,
      verificationSource,
      verificationEmail,
      safeContactDetails,
    };
  }

  async _clearOrganizationCache(organizationId) {
    await cacheService.del(`org:${organizationId}`);
    await cacheService.del(this._buildOrganizationCacheKey(organizationId));
  }

  _buildNonDeletedClientQuery(organizationId) {
    const { toSafeString } = require('../utils/security');
    return {
      organizationId: toSafeString(organizationId),
      $or: [
        { deletedAt: null },
        { deletedAt: { $exists: false } }
      ]
    };
  }

  _buildDeletedClientQuery(organizationId) {
    const { toSafeString } = require('../utils/security');
    return {
      organizationId: toSafeString(organizationId),
      deletedAt: { $ne: null }
    };
  }

  async createOrganization(organizationData) {
    try {
      const { organizationName, ownerEmail, ownerFirstName, ownerLastName } = organizationData;

      // Check if organization name already exists
      const escapedName = InputValidator.escapeRegExp(organizationName);
      const existingOrg = await Organization.findOne({
        name: { $regex: new RegExp(`^${escapedName}$`, 'i') }
      });

      if (existingOrg) {
        throw new Error('Organization name already exists');
      }

      // Generate unique organization code
      let organizationCode;
      let codeExists = true;

      while (codeExists) {
        organizationCode = generateOrganizationCode();
        const existingCode = await Organization.findOne({
          $or: [
            { organizationCode },
            { code: organizationCode },
          ],
        });
        codeExists = !!existingCode;
      }

      // Create organization document
      const organizationDoc = {
        name: organizationName,
        organizationCode,
        ownerEmail: ownerEmail,
        isActive: true,
        settings: {
          allowEmployeeInvites: true,
          maxEmployees: 100
        }
      };

      // Add owner name if provided (for legacy endpoint)
      if (ownerFirstName) organizationDoc.ownerFirstName = ownerFirstName;
      if (ownerLastName) organizationDoc.ownerLastName = ownerLastName;

      const newOrganization = new Organization(organizationDoc);
      const savedOrganization = await newOrganization.save();

      // Create UserOrganization record for owner (Zero-Trust requirement)
      if (ownerEmail) {
        try {
          // Find owner user by email
          const ownerUser = await User.findOne({ email: ownerEmail.toLowerCase() });
          
          if (ownerUser) {
            // Create UserOrganization for owner
            await UserOrganization.create({
              userId: ownerUser._id.toString(),
              organizationId: savedOrganization._id.toString(),
              role: 'owner',
              permissions: ['*'],
              isActive: true,
              joinedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date()
            });

            // Update user's organizationId if not set
            if (!ownerUser.organizationId) {
              await User.updateOne(
                { _id: ownerUser._id },
                { 
                  $set: { 
                    organizationId: savedOrganization._id.toString(),
                    role: 'owner'
                  }
                }
              );
            }
          } else {
            console.warn(`Owner user not found for email: ${ownerEmail}. UserOrganization not created.`);
          }
        } catch (orgError) {
          console.error('Failed to create UserOrganization for owner:', orgError.message);
          // Don't fail organization creation, but log the error
        }
      }

      return {
        organizationId: savedOrganization._id.toString(),
        organizationCode: organizationCode,
        organizationName: organizationName
      };
    } catch (error) {
      throw error;
    }
  }

  async verifyOrganizationCode(organizationCode) {
    try {
      await backfillLegacyOrganizationCodes();
      const normalizedCode = normalizeOrganizationCode(organizationCode);
      if (!normalizedCode) {
        return null;
      }

      const organization = await Organization.findOne({
        organizationCode: normalizedCode,
        isActive: true
      });

      if (!organization) {
        return null;
      }

      return {
        organizationId: organization._id.toString(),
        organizationName: organization.name,
        ownerEmail: organization.ownerEmail,
        organizationCode: getCanonicalOrganizationCode(organization),
      };
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationById(organizationId) {
    try {
      console.log('🔍 [GET ORG BY ID] Called with:', organizationId);
      console.log('🔍 [GET ORG BY ID] Mongoose connection state:', Organization.db?.readyState);
      console.log('🔍 [GET ORG BY ID] Database name:', Organization.db?.name);
      console.log('🔍 [GET ORG BY ID] Collection name:', Organization.collection?.name);

      const cacheKey = this._buildOrganizationCacheKey(organizationId);
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        console.log('🔍 [GET ORG BY ID] Returning cached result');
        return cached;
      }

      console.log('🔍 [GET ORG BY ID] Querying database...');
      const organization = await Organization.findById(organizationId);

      console.log('🔍 [GET ORG BY ID] Query result:', organization ? 'FOUND' : 'NOT FOUND');
      if (organization) {
        console.log('🔍 [GET ORG BY ID] Org name:', organization.name);
      }

      if (!organization) {
        console.log('🔍 [GET ORG BY ID] Returning null - organization not in database');
        return null;
      }

      const verificationMeta = await this._computeVerificationMeta(organization);

      const result = {
        id: organization._id.toString(),
        name: organization.name,
        tradingName: organization.tradingName || organization.name,
        code: getCanonicalOrganizationCode(organization),
        organizationCode: getCanonicalOrganizationCode(organization),
        ownerEmail: organization.ownerEmail,
        ownerEmailVerified: verificationMeta.ownerEmailVerified,
        organizationEmail: verificationMeta.organizationEmail,
        ownerFirstName: organization.ownerFirstName,
        ownerLastName: organization.ownerLastName,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        settings: organization.settings,
        abn: organization.abn,
        address: organization.address,
        contactDetails: verificationMeta.safeContactDetails,
        bankDetails: organization.bankDetails,
        ndisRegistration: organization.ndisRegistration,
        logoUrl: organization.logoUrl,
        isActive: organization.isActive,
        isVerified: verificationMeta.isVerified,
        organizationEmailVerified: verificationMeta.organizationEmailVerified,
        verificationSource: verificationMeta.verificationSource,
        verificationEmail: verificationMeta.verificationEmail,
      };

      await cacheService.set(cacheKey, result, 900); // 15 minutes
      return result;
    } catch (error) {
      throw error;
    }
  }

  async updateOrganizationDetails(organizationId, updates) {
    try {
      // Add updatedAt timestamp
      updates.updatedAt = new Date();

      const existingOrganization = await Organization.findById(organizationId);
      if (!existingOrganization) {
        return {
          found: false,
          modified: false,
        };
      }

      if (updates.contactDetails && typeof updates.contactDetails === 'object') {
        const existingContact = existingOrganization.contactDetails || {};
        const incomingContact = updates.contactDetails || {};
        const nextEmailRaw = Object.prototype.hasOwnProperty.call(
          incomingContact,
          'email',
        )
          ? incomingContact.email
          : existingContact.email;
        const nextEmail = this._normalizeEmail(nextEmailRaw);
        const existingEmail = this._normalizeEmail(existingContact.email);
        const ownerEmail = this._normalizeEmail(existingOrganization.ownerEmail);
        const ownerUser = ownerEmail
          ? await User.findOne({ email: ownerEmail }).select('emailVerified')
          : null;
        const ownerEmailVerified = Boolean(ownerUser?.emailVerified);

        const mergedContact = {
          ...existingContact,
          ...incomingContact,
        };

        if (!nextEmail) {
          mergedContact.email = incomingContact.email;
          mergedContact.emailVerified = false;
          mergedContact.emailVerificationTokenHash = null;
          mergedContact.emailVerificationExpiresAt = null;
          mergedContact.emailVerificationSentAt = null;
          mergedContact.emailVerifiedAt = null;
        } else if (nextEmail !== existingEmail) {
          const autoVerified = nextEmail === ownerEmail && ownerEmailVerified;
          mergedContact.email = nextEmail;
          mergedContact.emailVerified = autoVerified;
          mergedContact.emailVerificationTokenHash = null;
          mergedContact.emailVerificationExpiresAt = null;
          mergedContact.emailVerificationSentAt = null;
          mergedContact.emailVerifiedAt = autoVerified ? new Date() : null;
        }

        updates.contactDetails = mergedContact;
      }

      console.log('🔧 [SERVICE] updateOrganizationDetails called');
      console.log('🔧 [SERVICE] organizationId:', organizationId);
      console.log('🔧 [SERVICE] updates keys:', Object.keys(updates || {}));

      const result = await Organization.updateOne(
        { _id: organizationId },
        { $set: updates }
      );

      console.log('🔧 [SERVICE] MongoDB result:', JSON.stringify(result));
      console.log('🔧 [SERVICE] matchedCount:', result.matchedCount, 'modifiedCount:', result.modifiedCount);

      // Clear cache if organization was found (matched)
      if (result.matchedCount > 0) {
        await this._clearOrganizationCache(organizationId);
      }

      // Return object with both matchedCount and modifiedCount for better error handling
      return {
        found: result.matchedCount > 0,
        modified: result.modifiedCount > 0
      };
    } catch (error) {
      console.log('🔧 [SERVICE] Error:', error.message);
      throw error;
    }
  }

  async sendOrganizationContactVerification(organizationId, baseUrl) {
    const organization = await Organization.findById(organizationId);

    if (!organization) {
      return { found: false };
    }

    const contactDetails = organization.contactDetails || {};
    const organizationEmail = this._normalizeEmail(contactDetails.email);

    if (!organizationEmail) {
      return { found: true, hasEmail: false };
    }

    const verificationMeta = await this._computeVerificationMeta(organization);
    const ownerEmail = this._normalizeEmail(organization.ownerEmail);
    const sameAsOwner =
      verificationMeta.organizationEmail &&
      ownerEmail &&
      verificationMeta.organizationEmail === ownerEmail;

    if (verificationMeta.organizationEmailVerified) {
      return {
        found: true,
        hasEmail: true,
        alreadyVerified: true,
        organizationEmail,
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this._hashVerificationToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const verificationUrl =
      `${String(baseUrl || '').replace(/\/$/, '')}/api/organization/contact-email/verify?token=${token}`;

    organization.contactDetails = {
      ...contactDetails,
      email: organizationEmail,
      emailVerified: false,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
      emailVerificationSentAt: new Date(),
    };

    await organization.save();
    await this._clearOrganizationCache(organizationId);

    const subject = 'Verify your organization email - CareNest';
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 24px; color: #111;">
        <h2 style="margin: 0 0 16px;">Verify your organization email</h2>
        <p style="margin: 0 0 16px;">
          Confirm <strong>${organizationEmail}</strong> as the public contact email for
          <strong>${organization.name}</strong>.
        </p>
        <p style="margin: 24px 0;">
          <a href="${verificationUrl}" style="display: inline-block; padding: 12px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 700;">
            Verify Organization Email
          </a>
        </p>
        <p style="margin: 0 0 8px;">If the button does not work, paste this link into your browser:</p>
        <p style="word-break: break-all; color: #555;">${verificationUrl}</p>
        <p style="margin-top: 20px; color: #777; font-size: 12px;">
          This link expires in 24 hours. If you did not request this, you can ignore this email.
        </p>
      </div>
    `;

    const sendResult = await emailService.sendEmail(
      organizationEmail,
      subject,
      html,
    );

    if (!sendResult) {
      return {
        found: true,
        hasEmail: true,
        sendFailed: true,
        organizationEmail,
      };
    }

    return {
      found: true,
      hasEmail: true,
      sent: true,
      organizationEmail,
      expiresAt,
    };
  }

  async verifyOrganizationContactEmail(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) {
      return { success: false, reason: 'missing_token' };
    }

    const tokenHash = this._hashVerificationToken(token);
    const organization = await Organization.findOne({
      'contactDetails.emailVerificationTokenHash': tokenHash,
      'contactDetails.emailVerificationExpiresAt': { $gt: new Date() },
    });

    if (!organization) {
      return { success: false, reason: 'invalid_or_expired' };
    }

    const contactDetails = organization.contactDetails || {};
    organization.contactDetails = {
      ...contactDetails,
      emailVerified: true,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      emailVerificationSentAt: null,
      emailVerifiedAt: new Date(),
    };

    await organization.save();
    await this._clearOrganizationCache(organization._id.toString());

    return {
      success: true,
      organizationName: organization.name,
      organizationEmail: this._normalizeEmail(contactDetails.email),
    };
  }

  async getOrganizationMembers(organizationId) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeOrgId = toSafeString(organizationId);

      // Query UserOrganization for zero-trust compliance
      const userOrgs = await UserOrganization.find({
        organizationId: safeOrgId,
        isActive: true
      }).lean();

      console.log('[getOrganizationMembers] UserOrganization query result:', userOrgs.length, 'records');

      if (!userOrgs || userOrgs.length === 0) {
        console.log('[getOrganizationMembers] No UserOrganization records found');
        return [];
      }

      // Get user IDs (convert to ObjectId for query)
      const userIds = userOrgs.map(uo => {
        try {
          const idStr = String(uo.userId).trim();
          return new mongoose.Types.ObjectId(idStr);
        } catch (e) {
          return uo.userId;
        }
      });

      // Fetch user details
      const employees = await User.find({
        _id: { $in: userIds },
        isActive: true
      }, '-password -salt').lean();

      const filtered = [];

      for (const emp of employees) {
        const organizationRecord = userOrgs.find(
          uo => String(uo.userId) === String(emp._id)
        );

        const orgRole = (organizationRecord?.role || '').toLowerCase();
        const legacyRole = (emp.role || '').toLowerCase();
        const employeeRoles = Array.isArray(emp.roles)
          ? emp.roles.map(role => (role || '').toLowerCase())
          : [];
        if (legacyRole) {
          employeeRoles.push(legacyRole);
        }
        const clientId = emp.clientId ? String(emp.clientId).trim() : '';

        const isClient =
          orgRole === 'client' ||
          employeeRoles.includes('client') ||
          clientId.length > 0;

        if (isClient) continue;

        filtered.push({
          ...emp,
          payRate: emp.payRate || null,
          payType: emp.payType || 'Hourly',
          payRates: emp.payRates || null,
          organizationRole: organizationRecord?.role,
          organizationPermissions: organizationRecord?.permissions,
          joinedAt: organizationRecord?.joinedAt
        });
      }

      return filtered;
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationBusinesses(organizationId) {
    try {
      const { toSafeString } = require('../utils/security');
      return await Business.find({
        organizationId: toSafeString(organizationId),
        isActive: true
      }).lean();
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationClients(organizationId) {
    try {
      const clients = await Client.find(
        this._buildNonDeletedClientQuery(organizationId)
      ).lean();

      if (!clients || clients.length === 0) {
        return [];
      }

      return clients.map(client => {
        const firstName = client.clientFirstName || client.firstName || '';
        const lastName = client.clientLastName || client.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        return {
          ...client,
          firstName,
          lastName,
          name: client.name || fullName || client.clientEmail || client.email || 'Client',
          email: client.clientEmail || client.email,
          isActive: !client.deletedAt && client.isActive !== false,
          isActivated: Boolean(client.isActivated),
          activationPending: Boolean(client.activationPending)
        };
      });
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationDeletedClients(organizationId) {
    try {
      const clients = await Client.find(
        this._buildDeletedClientQuery(organizationId)
      )
        .sort({ deletedAt: -1, updatedAt: -1 })
        .lean();

      if (!clients || clients.length === 0) {
        return [];
      }

      return clients.map(client => ({
        ...client,
        isActive: false,
        isActivated: false,
        activationPending: Boolean(client.activationPending)
      }));
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationEmployees(organizationId) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeOrgId = toSafeString(organizationId);

      // Query UserOrganization for zero-trust compliance
      const userOrgs = await UserOrganization.find({
        organizationId: safeOrgId,
        isActive: true
      }).lean();

      if (!userOrgs || userOrgs.length === 0) {
        return [];
      }

      // Get user IDs
      const userIds = userOrgs.map(uo => {
        try {
          const idStr = String(uo.userId).trim();
          return new mongoose.Types.ObjectId(idStr);
        } catch (e) {
          return uo.userId;
        }
      });

      // Fetch user details
      const employees = await User.find({
        _id: { $in: userIds },
        isActive: true
      }, '-password -salt').lean();

      const filtered = [];

      for (const emp of employees) {
        const userOrg = userOrgs.find(
          uo => String(uo.userId) === String(emp._id)
        );
        const orgRole = (userOrg?.role || '').toLowerCase();
        const legacyRole = (emp.role || '').toLowerCase();
        const employeeRoles = Array.isArray(emp.roles)
          ? emp.roles.map(role => (role || '').toLowerCase())
          : [];
        if (legacyRole) {
          employeeRoles.push(legacyRole);
        }
        const clientId = emp.clientId ? String(emp.clientId).trim() : '';

        const isClient =
          orgRole === 'client' ||
          employeeRoles.includes('client') ||
          clientId.length > 0;

        if (isClient) continue;

        filtered.push({
          ...emp,
          payRate: emp.payRate || null,
          payType: emp.payType || 'Hourly',
          payRates: emp.payRates || null,
          organizationRole: userOrg?.role,
          organizationPermissions: userOrg?.permissions,
          joinedAt: userOrg?.joinedAt
        });
      }

      return filtered;
    } catch (error) {
      throw error;
    }
  }

  // Multi-Tenant Methods

  async switchOrganization(userId, organizationId) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeUserId = toSafeString(userId);
      const safeOrgId = toSafeString(organizationId);

      // Validate access
      const userOrg = await UserOrganization.findOne({ userId: safeUserId, organizationId: safeOrgId, isActive: true });
      if (!userOrg) {
        throw new Error('Access denied to organization');
      }

      // Update user's last active organization
      await User.findByIdAndUpdate(safeUserId, { lastActiveOrganizationId: safeOrgId });

      // Return organization details with branding
      const org = await this.getOrganizationById(organizationId);
      const branding = await this.getOrganizationBranding(organizationId);

      return { organization: org, branding, role: userOrg.role, permissions: userOrg.permissions };
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationBranding(organizationId) {
    try {
      let branding = await OrganizationBranding.findOne({ organizationId });
      if (!branding) {
        // Return defaults if not set
        return {
          primaryColor: '#DC143C',
          secondaryColor: '#0066CC',
          invoiceTemplate: { showLogo: true }
        };
      }
      return branding;
    } catch (error) {
      throw error;
    }
  }

  async updateOrganizationBranding(organizationId, brandingData) {
    try {
      return await OrganizationBranding.findOneAndUpdate(
        { organizationId },
        { $set: brandingData },
        { new: true, upsert: true }
      );
    } catch (error) {
      throw error;
    }
  }

  async getUserOrganizations(userId) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeUserId = toSafeString(userId);
      const userOrgs = await UserOrganization.find({ userId: safeUserId, isActive: true })
        .populate('organizationId', 'name organizationCode code logoUrl');

      return userOrgs.map(uo => ({
        id: uo.organizationId._id,
        name: uo.organizationId.name,
        code: getCanonicalOrganizationCode(uo.organizationId),
        organizationCode: getCanonicalOrganizationCode(uo.organizationId),
        logoUrl: uo.organizationId.logoUrl,
        role: uo.role,
        lastAccessedAt: uo.lastAccessedAt
      }));
    } catch (error) {
      throw error;
    }
  }

  async addSharedEmployee(employeeId, targetOrgId, assignmentData) {
    try {
      const { toSafeString } = require('../utils/security');
      const safeEmployeeId = toSafeString(employeeId);
      const safeTargetOrgId = toSafeString(targetOrgId);

      // Check if assignment exists
      const existing = await SharedEmployeeAssignment.findOne({
        employeeId: safeEmployeeId,
        organizationId: safeTargetOrgId,
        status: 'active'
      });

      if (existing) {
        throw new Error('Employee is already assigned to this organization');
      }

      const assignment = new SharedEmployeeAssignment({
        employeeId,
        organizationId: targetOrgId,
        ...assignmentData
      });

      await assignment.save();

      // Also create UserOrganization entry
      await UserOrganization.create({
        userId: employeeId,
        organizationId: targetOrgId,
        role: 'shared_employee',
        permissions: ['read', 'write'] // Default permissions, should be refined
      });

      return assignment;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update organization setup with detailed information
   * @param {string} organizationId - Organization ID
   * @param {object} setupData - Setup data (logo, ABN, address, etc.)
   * @returns {Promise<object>} Updated organization
   */
  async updateOrganizationSetup(organizationId, setupData) {
    try {
      const {
        logoUrl,
        abn,
        address,
        contactDetails,
        bankDetails,
        ndisRegistration,
        timesheetReminders,
        defaultPricingSettings,
        updatedBy
      } = setupData;

      // Find organization
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        throw new Error('Organization not found');
      }

      // Update fields if provided
      const updateFields = {};
      
      if (logoUrl !== undefined) updateFields.logoUrl = logoUrl;
      if (abn !== undefined) updateFields.abn = abn;
      if (address !== undefined) updateFields.address = address;
      
      if (contactDetails !== undefined) {
        updateFields.contactDetails = {
          ...organization.contactDetails,
          ...contactDetails
        };
      }
      
      if (bankDetails !== undefined) {
        updateFields.bankDetails = {
          ...organization.bankDetails,
          ...bankDetails
        };
      }
      
      if (ndisRegistration !== undefined) {
        updateFields.ndisRegistration = {
          ...organization.ndisRegistration,
          ...ndisRegistration
        };
      }
      
      if (timesheetReminders !== undefined) {
        updateFields.timesheetReminders = {
          ...organization.timesheetReminders,
          ...timesheetReminders
        };
      }
      
      if (defaultPricingSettings !== undefined) {
        updateFields.defaultPricingSettings = {
          ...organization.defaultPricingSettings,
          ...defaultPricingSettings
        };
      }

      updateFields.updatedAt = new Date();

      // Update organization
      const updatedOrganization = await Organization.findByIdAndUpdate(
        organizationId,
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      // Clear cache
      await cacheService.del(`organization:${organizationId}`);

      return updatedOrganization;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new OrganizationService();
