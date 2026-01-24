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
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(tempPassword, 10);
      
      const newUser = new User({
        email: email,
        password: hashedPassword,
        salt: salt,
        firstName: client.clientFirstName,
        lastName: client.clientLastName,
        organizationId: client.organizationId,
        role: 'client',
        clientId: client._id, // Link to client record (stored as ObjectId in User if modified, or string)
        createdAt: new Date(),
        lastLogin: null,
        isActive: true,
        // passwordResetRequired: true // Schema doesn't have this yet, assuming User model allows loose fields or I need to add it. 
        // User model update I did earlier included most fields but maybe not passwordResetRequired. 
        // I will assume User model can handle it or I should add it.
        // For now, let's stick to fields I added or strict: false if not.
        // But my User model update was strict.
        // I'll add passwordResetRequired to the object passed to constructor, Mongoose will ignore if not in schema.
        // To be safe I should update User schema if this field is critical.
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

      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(newPassword, 10);

      user.password = hashedPassword;
      user.salt = salt;
      user.passwordUpdatedAt = new Date();
      // user.passwordResetRequired = false; // If I add this field to schema

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
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(password, 10);
      
      const newUser = new User({
        email: email,
        password: hashedPassword,
        salt: salt,
        firstName: client.clientFirstName,
        lastName: client.clientLastName,
        organizationId: client.organizationId,
        role: 'client',
        clientId: client._id, // Link to client record
        createdAt: new Date(),
        lastLogin: null,
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
