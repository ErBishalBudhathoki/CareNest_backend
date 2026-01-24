const User = require('../models/User');
const Business = require('../models/Business');

class BusinessService {
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
      
      // Verify user belongs to organization (if organizationId provided)
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      // Check for duplicate business (same name and email within organization)
      const existingBusiness = await Business.findOne({
        businessName: businessName,
        businessEmail: businessEmail,
        organizationId: organizationId || null,
        isActive: true
      });
      
      if (existingBusiness) {
        throw new Error('Business with this name and email already exists');
      }
      
      // Create business document with organization context
      const newBusiness = new Business({
        businessName: businessName,
        businessEmail: businessEmail,
        businessPhone: businessPhone,
        businessAddress: businessAddress,
        businessCity: businessCity,
        businessState: businessState,
        businessZip: businessZip,
        organizationId: organizationId || null,
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
}

module.exports = new BusinessService();
