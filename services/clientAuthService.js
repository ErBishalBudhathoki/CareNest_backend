const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDatabase } = require('../config/database');
const auditService = require('./auditService');

const emailService = require('./emailService');

class ClientAuthService {
  constructor() {
    this.db = null;
  }

  async getDb() {
    if (!this.db) {
      this.db = await getDatabase();
    }
    return this.db;
  }

  /**
   * Activate client account by Admin
   * @param {string} email - Client email
   * @returns {Object} - Created user data
   */
  async activateClientByAdmin(email) {
    try {
      const db = await this.getDb();
      
      // 1. Verify client exists in 'clients' collection
      const client = await db.collection('clients').findOne({ clientEmail: email });
      if (!client) {
        throw new Error('Client email not found in records');
      }

      // 2. Check if user already exists in 'login' collection
      const existingUser = await db.collection('login').findOne({ email: email });
      if (existingUser) {
        throw new Error('Account already activated.');
      }

      // 3. Generate secure temporary password
      const tempPassword = crypto.randomBytes(8).toString('hex'); // 16 chars hex

      // 4. Create user in 'login' collection
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(tempPassword, 10);
      
      const newUser = {
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
        isActive: true,
        passwordResetRequired: true // Force password change
      };
      
      const result = await db.collection('login').insertOne(newUser);
      
      // 5. Send Activation Email
      await emailService.sendClientActivationEmail(email, tempPassword);

      // 6. Log audit trail
      await auditService.createAuditTrail({
        action: 'CLIENT_ACCOUNT_ACTIVATED_BY_ADMIN',
        userId: result.insertedId.toString(),
        userEmail: email,
        organizationId: client.organizationId,
        details: {
          clientId: client._id.toString(),
          role: 'client'
        },
        timestamp: new Date()
      });

      return { ...newUser, _id: result.insertedId };
    } catch (error) {
      throw new Error(`Client activation failed: ${error.message}`);
    }
  }

  /**
   * Change Password (Client Self-Service)
   */
  async changePassword(email, currentPassword, newPassword) {
    try {
      const db = await this.getDb();
      const user = await db.collection('login').findOne({ email: email });

      if (!user) throw new Error('User not found');

      // Verify current password (if provided - usually required)
      // But if it's the first time login with temp password, user might just provide it as "current"
      const isValid = bcrypt.compareSync(currentPassword, user.password);
      if (!isValid) throw new Error('Invalid current password');

      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(newPassword, 10);

      await db.collection('login').updateOne(
        { email: email },
        { 
          $set: { 
            password: hashedPassword,
            salt: salt,
            passwordResetRequired: false, // Reset flag
            passwordUpdatedAt: new Date()
          } 
        }
      );

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
      const db = await this.getDb();
      
      // 1. Verify client exists in 'clients' collection
      const client = await db.collection('clients').findOne({ clientEmail: email });
      if (!client) {
        throw new Error('Client email not found in records');
      }

      // 2. Check if user already exists in 'login' collection
      const existingUser = await db.collection('login').findOne({ email: email });
      if (existingUser) {
        throw new Error('Account already activated. Please login.');
      }

      // 3. Create user in 'login' collection
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(password, 10);
      
      const newUser = {
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
      };
      
      const result = await db.collection('login').insertOne(newUser);
      
      // 4. Log audit trail
      await auditService.createAuditTrail({
        action: 'CLIENT_ACCOUNT_ACTIVATED',
        userId: result.insertedId.toString(),
        userEmail: email,
        organizationId: client.organizationId,
        details: {
          clientId: client._id.toString(),
          role: 'client'
        },
        timestamp: new Date()
      });

      return { ...newUser, _id: result.insertedId };
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
      const db = await this.getDb();
      const user = await db.collection('login').findOne({ _id: new ObjectId(userId) });
      
      if (!user || user.role !== 'client') {
        throw new Error('User is not a valid client');
      }

      const client = await db.collection('clients').findOne({ _id: user.clientId });
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
