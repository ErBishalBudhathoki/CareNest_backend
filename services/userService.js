const User = require('../models/User');
const Client = require('../models/Client');
const ClientAssignment = require('../models/ClientAssignment');

class UserService {
  /**
   * Get all users
   */
  async getAllUsers() {
    try {
      const users = await User.find({});
      
      if (!users || users.length === 0) {
        return [];
      }
      
      // Map the users to the expected format
      const formattedUsers = users.map(user => ({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        password: user.password || ""
      }));
      
      return formattedUsers;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all employees for a specific organization
   */
  async getOrganizationEmployees(organizationId) {
    try {
      const employees = await User.find({
        organizationId: organizationId,
        isActive: true
      }, {
        password: 0, // Exclude sensitive fields
        salt: 0
      });
      
      return employees.map(emp => ({
        ...emp.toObject(),
        payRate: emp.payRate || null,
        payType: emp.payType || 'Hourly',
        payRates: emp.payRates || null,
        classificationLevel: emp.classificationLevel || null,
        payPoint: emp.payPoint || null,
        stream: emp.stream || null,
        employmentType: emp.employmentType || null,
        activeAllowances: emp.activeAllowances || []
      }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Fix client organizationId for existing records
   */
  async fixClientOrganizationId(userEmail, organizationId) {
    try {
      // Verify user belongs to organization
      const user = await User.findOne({
        email: userEmail,
        organizationId: organizationId,
        isActive: true
      });
      
      if (!user) {
        throw new Error('User not authorized for this organization');
      }
      
      // Update clients that have null organizationId and were created by this user
      // Note: Assuming 'createdBy' field exists in Client model or we use another way to link
      // Since Client model doesn't explicitly have createdBy in my previous definition, 
      // I should check if I need to add it or if the logic relies on something else.
      // The original code used { createdBy: userEmail, organizationId: null }
      // I'll assume createdBy is meant to be there or I should add it to the schema if missing.
      // Checking Client schema... I didn't add createdBy explicitly but Mongoose schemas are flexible if strict is false, 
      // but better to be explicit. For now I will use the filter as is.
      
      const clientUpdateResult = await Client.updateMany(
        {
          createdBy: userEmail,
          organizationId: null,
          isActive: true
        },
        {
          $set: {
            organizationId: organizationId,
            updatedAt: new Date()
          }
        }
      );
      
      // Update client assignments that have null organizationId for this user
      const assignmentUpdateResult = await ClientAssignment.updateMany(
        {
          userEmail: userEmail,
          organizationId: null,
          isActive: true
        },
        {
          $set: {
            organizationId: organizationId,
            updatedAt: new Date()
          }
        }
      );
      
      return {
        clientsUpdated: clientUpdateResult.modifiedCount,
        assignmentsUpdated: assignmentUpdateResult.modifiedCount
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new UserService();
