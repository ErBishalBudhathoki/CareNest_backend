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

class OrganizationService {

  async createOrganization(organizationData) {
    try {
      const { organizationName, ownerEmail, ownerFirstName, ownerLastName } = organizationData;

      // Check if organization name already exists
      const existingOrg = await Organization.findOne({
        name: { $regex: new RegExp(`^${organizationName}$`, 'i') }
      });

      if (existingOrg) {
        throw new Error('Organization name already exists');
      }

      // Generate unique organization code
      let organizationCode;
      let codeExists = true;

      while (codeExists) {
        organizationCode = generateOrganizationCode();
        const existingCode = await Organization.findOne({ code: organizationCode });
        codeExists = !!existingCode;
      }

      // Create organization document
      const organizationDoc = {
        name: organizationName,
        code: organizationCode,
        organizationCode: organizationCode, // Ensure compatibility with schema
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
      const organization = await Organization.findOne({
        organizationCode: organizationCode,
        isActive: true
      });

      if (!organization) {
        return null;
      }

      return {
        organizationId: organization._id.toString(),
        organizationName: organization.name,
        ownerEmail: organization.ownerEmail
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

      const cacheKey = `org:${organizationId}`;
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

      const result = {
        id: organization._id.toString(),
        name: organization.name,
        tradingName: organization.tradingName || organization.name,
        code: organization.code || organization.organizationCode,
        ownerEmail: organization.ownerEmail,
        ownerFirstName: organization.ownerFirstName,
        ownerLastName: organization.ownerLastName,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        settings: organization.settings,
        abn: organization.abn,
        address: organization.address,
        contactDetails: organization.contactDetails,
        bankDetails: organization.bankDetails,
        ndisRegistration: organization.ndisRegistration,
        logoUrl: organization.logoUrl,
        isActive: organization.isActive
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
        await cacheService.del(`org:${organizationId}`);
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

  async getOrganizationMembers(organizationId) {
    try {
      // Query UserOrganization for zero-trust compliance
      const userOrgs = await UserOrganization.find({
        organizationId: organizationId,
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

      // Merge user data with organization role/permissions
      return employees.map(emp => {
        const userOrg = userOrgs.find(uo => uo.userId === emp._id.toString());
        return {
          ...emp,
          payRate: emp.payRate || null,
          payType: emp.payType || 'Hourly',
          payRates: emp.payRates || null,
          organizationRole: userOrg?.role,
          organizationPermissions: userOrg?.permissions,
          joinedAt: userOrg?.joinedAt
        };
      });
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationEmployees(organizationId) {
    try {
      // Query UserOrganization for zero-trust compliance
      const userOrgs = await UserOrganization.find({
        organizationId: organizationId,
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

      // Merge user data with organization role/permissions
      return employees.map(emp => {
        const userOrg = userOrgs.find(uo => uo.userId === emp._id.toString());
        return {
          ...emp,
          payRate: emp.payRate || null,
          payType: emp.payType || 'Hourly',
          payRates: emp.payRates || null,
          organizationRole: userOrg?.role,
          organizationPermissions: userOrg?.permissions,
          joinedAt: userOrg?.joinedAt
        };
      });
    } catch (error) {
      throw error;
    }
  }

  // Multi-Tenant Methods

  async switchOrganization(userId, organizationId) {
    try {
      // Validate access
      const userOrg = await UserOrganization.findOne({ userId, organizationId, isActive: true });
      if (!userOrg) {
        throw new Error('Access denied to organization');
      }

      // Update user's last active organization
      await User.findByIdAndUpdate(userId, { lastActiveOrganizationId: organizationId });

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
      const userOrgs = await UserOrganization.find({ userId, isActive: true })
        .populate('organizationId', 'name code logoUrl');

      return userOrgs.map(uo => ({
        id: uo.organizationId._id,
        name: uo.organizationId.name,
        code: uo.organizationId.code,
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
      // Check if assignment exists
      const existing = await SharedEmployeeAssignment.findOne({
        employeeId,
        organizationId: targetOrgId,
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
