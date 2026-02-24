const User = require('../models/User');
const Business = require('../models/Business');

class BusinessService {
  createServiceError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  async verifyUserOrganizationAccess(organizationId, userEmail) {
    if (!organizationId || !userEmail) return;

    const user = await User.findOne({
      email: userEmail,
      organizationId: organizationId
    });

    if (!user) {
      throw this.createServiceError('User not authorized for this organization', 403);
    }
  }

  /**
   * Add a new business with organization context
   */
  async addBusiness(businessData) {
    try {
      const { 
        businessName, 
        businessEmail, 
        businessPhone, 
        businessAddress, 
        businessCity, 
        businessState, 
        businessZip,
        organizationId,
        userEmail 
      } = businessData;

      if (!organizationId) {
        throw this.createServiceError('Organization ID is required', 400);
      }
      
      // Verify user belongs to organization (if organizationId provided)
      await this.verifyUserOrganizationAccess(organizationId, userEmail);
      
      // Check for duplicate business (same name and email within organization)
      const existingBusiness = await Business.findOne({
        businessName: businessName,
        businessEmail: businessEmail.toLowerCase(),
        organizationId: organizationId,
        isActive: true
      });
      
      if (existingBusiness) {
        throw this.createServiceError('Business with this name and email already exists', 409);
      }
      
      // Create business document with organization context
      const newBusiness = new Business({
        businessName: businessName,
        businessEmail: businessEmail.toLowerCase(),
        businessPhone: businessPhone,
        businessAddress: businessAddress,
        businessCity: businessCity,
        businessState: businessState,
        businessZip: businessZip,
        organizationId: organizationId,
        createdBy: userEmail,
        isActive: true
      });
      
      const savedBusiness = await newBusiness.save();
      return savedBusiness._id.toString();
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Get businesses for organization
   */
  async getBusinessesByOrganization(organizationId) {
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

  /**
   * Update business core details
   */
  async updateBusiness(businessId, updateData, organizationId, userEmail) {
    try {
      if (!organizationId) {
        throw this.createServiceError('Organization ID is required', 400);
      }

      await this.verifyUserOrganizationAccess(organizationId, userEmail);

      const allowedFields = [
        'businessName',
        'businessEmail',
        'businessPhone',
        'businessAddress',
        'businessCity',
        'businessState',
        'businessZip',
      ];

      const sanitizedUpdateData = {};
      for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(updateData, field)) {
          sanitizedUpdateData[field] = updateData[field];
        }
      }

      if (Object.keys(sanitizedUpdateData).length === 0) {
        throw this.createServiceError('No valid fields provided for update', 400);
      }

      if (typeof sanitizedUpdateData.businessEmail === 'string') {
        sanitizedUpdateData.businessEmail = sanitizedUpdateData.businessEmail.toLowerCase();
      }

      const business = await Business.findOne({
        _id: businessId,
        organizationId,
        isActive: true,
      });

      if (!business) {
        throw this.createServiceError('Business not found', 404);
      }

      const candidateBusinessName =
        sanitizedUpdateData.businessName ?? business.businessName;
      const candidateBusinessEmail =
        sanitizedUpdateData.businessEmail ?? business.businessEmail;

      const duplicate = await Business.findOne({
        _id: { $ne: businessId },
        organizationId,
        businessName: candidateBusinessName,
        businessEmail: candidateBusinessEmail,
        isActive: true,
      });

      if (duplicate) {
        throw this.createServiceError('Business with this name and email already exists', 409);
      }

      await Business.updateOne(
        { _id: businessId, organizationId, isActive: true },
        {
          $set: {
            ...sanitizedUpdateData,
            updatedAt: new Date(),
          },
        }
      );

      return {
        success: true,
        message: 'Business updated successfully',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Soft-delete business
   */
  async deleteBusiness(businessId, organizationId, userEmail) {
    try {
      if (!organizationId) {
        throw this.createServiceError('Organization ID is required', 400);
      }

      await this.verifyUserOrganizationAccess(organizationId, userEmail);

      const result = await Business.findOneAndUpdate(
        {
          _id: businessId,
          organizationId,
          isActive: true,
        },
        {
          $set: {
            isActive: false,
            deletedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!result) {
        throw this.createServiceError('Business not found', 404);
      }

      return {
        success: true,
        message: 'Business deleted successfully',
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new BusinessService();
