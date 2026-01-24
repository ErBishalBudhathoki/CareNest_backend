const Organization = require('../models/Organization');
const User = require('../models/User');
const Business = require('../models/Business');
const Client = require('../models/Client');
const { generateOrganizationCode } = require('../utils/cryptoHelpers');

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
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        return null;
      }
      
      return {
        id: organization._id.toString(),
        name: organization.name,
        tradingName: organization.tradingName,
        code: organization.organizationCode,
        ownerEmail: organization.ownerEmail,
        createdAt: organization.createdAt,
        settings: organization.settings,
        abn: organization.abn,
        address: organization.address,
        contactDetails: organization.contactDetails,
        bankDetails: organization.bankDetails,
        ndisRegistration: organization.ndisRegistration,
        logoUrl: organization.logoUrl,
        isActive: organization.isActive
      };
    } catch (error) {
      throw error;
    }
  }

  async updateOrganizationDetails(organizationId, updates) {
    try {
      const result = await Organization.updateOne(
        { _id: organizationId },
        { $set: updates }
      );
      
      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationMembers(organizationId) {
    try {
      const members = await User.find({ 
        organizationId: organizationId 
      }, '-password -salt'); // Exclude sensitive fields
      
      return members;
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationBusinesses(organizationId) {
    try {
      const businesses = await Business.find({ 
        organizationId: organizationId,
        isActive: true 
      });
      
      return businesses;
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationClients(organizationId) {
    try {
      const clients = await Client.find({ 
        organizationId: organizationId,
        isActive: true 
      });
      
      return clients;
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationEmployees(organizationId) {
    try {
      const employees = await User.find({ 
        organizationId: organizationId,
        isActive: true 
      }, '-password -salt');
      
      return employees.map(emp => ({
        ...emp.toObject(),
        payRate: emp.payRate || null,
        payType: emp.payType || 'Hourly',
        payRates: emp.payRates || null
      }));
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new OrganizationService();
