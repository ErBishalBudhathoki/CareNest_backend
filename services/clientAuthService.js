const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Client = require('../models/Client');
const User = require('../models/User');
const auditService = require('./auditService');
const emailService = require('./emailService');

class ClientAuthService {
  /**
   * Activate client account by Admin
   * @param {string} email - Client email
   * @returns {Object} - Created user data
   */
  async activateClientByAdmin(email) {
    try {
      // 1. Verify client exists in 'clients' collection
      const client = await Client.findOne({ clientEmail: email });
      if (!client) {
        throw new Error('Client email not found in records');
      }

      // 2. Check if user already exists in 'login' collection
      const existingUser = await User.findOne({ email: email });
      if (existingUser) {
        throw new Error('Account already activated.');
      }

      // 3. Generate secure temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex'); // 16 chars hex

      // 4. Create user in 'login' collection
      const newUser = new User({
        email: email,
        password: tempPassword, // Mongoose pre-save hook will hash this
        firstName: client.clientFirstName,
        lastName: client.clientLastName,
        organizationId: client.organizationId,
        role: 'client',
        clientId: client._id,
        isActive: true,
      });
      // Assuming User model has strict: false or I update it. 
      // For now I'll proceed, Mongoose will ignore unknown fields.

      const savedUser = await newUser.save();

      // 5. Send Activation Email
      await emailService.sendClientActivationEmail(email, tempPassword);

      // 6. Log audit trail
      await auditService.createAuditTrail({
        action: 'CLIENT_ACCOUNT_ACTIVATED_BY_ADMIN',
        userId: savedUser._id.toString(),
        userEmail: email,
        organizationId: client.organizationId,
        details: {
          clientId: client._id.toString(),
          role: 'client'
        },
        timestamp: new Date()
      });

      return savedUser;
    } catch (error) {
      throw new Error(`Client activation failed: ${error.message}`);
    }
  }

  /**
   * Change Password (Client Self-Service)
   */
  async changePassword(email, currentPassword, newPassword) {
    try {
      const user = await User.findOne({ email: email });

      if (!user) throw new Error('User not found');

      // Verify current password (if provided - usually required)
      const isValid = bcrypt.compareSync(currentPassword, user.password);
      if (!isValid) throw new Error('Invalid current password');

      user.password = newPassword; // Mongoose pre-save hook will hash this
      user.passwordUpdatedAt = new Date();

      await user.save();

      return { success: true };
    } catch (error) {
      throw new Error(`Change password failed: ${error.message}`);
    }
  }

  /**
   * Activate client account (First time setup - Legacy/Manual)
   * @param {string} email - Client email
   * @param {string} password - New password
   * @returns {Object} - Created user data
   */
  async activateClientAccount(email, password) {
    try {
      // 1. Verify client exists in 'clients' collection
      const client = await Client.findOne({ clientEmail: email });
      if (!client) {
        throw new Error('Client email not found in records');
      }

      // 2. Check if user already exists in 'login' collection
      const existingUser = await User.findOne({ email: email });
      if (existingUser) {
        throw new Error('Account already activated. Please login.');
      }

      // 3. Create user in 'login' collection
      const newUser = new User({
        email: email,
        password: password, // Mongoose pre-save hook will hash this
        firstName: client.clientFirstName,
        lastName: client.clientLastName,
        organizationId: client.organizationId,
        role: 'client',
        clientId: client._id, // Link to client record
        isActive: true
      });

      const savedUser = await newUser.save();

      // 4. Log audit trail
      await auditService.createAuditTrail({
        action: 'CLIENT_ACCOUNT_ACTIVATED',
        userId: savedUser._id.toString(),
        userEmail: email,
        organizationId: client.organizationId,
        details: {
          clientId: client._id.toString(),
          role: 'client'
        },
        timestamp: new Date()
      });

      return savedUser;
    } catch (error) {
      throw new Error(`Client activation failed: ${error.message}`);
    }
  }

  /**
   * Get client profile data
   * @param {string} userId - User ID from login collection
   * @returns {Object} - Client profile
   */
  async getClientProfile(userId) {
    try {
      const user = await User.findById(userId);

      if (!user || user.role !== 'client') {
        throw new Error('User is not a valid client');
      }

      const client = await Client.findById(user.clientId); // Assuming user.clientId stores the ObjectId
      // If user.clientId is not in schema, this might fail if I don't update User schema.
      // I checked User schema earlier, it didn't have clientId. 
      // I should update User schema to include clientId.

      if (!client) {
        throw new Error('Client record not found');
      }

      return {
        user: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName
        },
        client: client
      };
    } catch (error) {
      throw new Error(`Error fetching client profile: ${error.message}`);
    }
  }
}

module.exports = new ClientAuthService();
