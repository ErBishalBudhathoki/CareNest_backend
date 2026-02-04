const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Client = require('../models/Client');
const Organization = require('../models/Organization');
const auditService = require('./auditService');
const emailService = require('./emailService');

class AuthService {
  /**
   * Check if email exists in the system
   * @param {string} email - User email
   * @returns {Object} - User data if exists, null otherwise
   */
  async checkEmailExists(email) {
    try {
      const user = await User.findOne({ email: email });
      return user;
    } catch (error) {
      throw new Error(`Error checking email: ${error.message}`);
    }
  }

  /**
   * Get client details by email
   * @param {string} email - Client email
   * @returns {Object} - Client data if exists, null otherwise
   */
  async getClientDetails(email) {
    try {
      const client = await Client.findOne({ email: email });
      return client;
    } catch (error) {
      throw new Error(`Error getting client details: ${error.message}`);
    }
  }

  /**
   * Validate organization code
   * @param {string} organizationCode - Organization code to validate
   * @returns {Object} - Organization data if valid, null otherwise
   */
  async validateOrganizationCode(organizationCode) {
    try {
      const organization = await Organization.findOne({
        organizationCode: organizationCode
      });
      return organization;
    } catch (error) {
      throw new Error(`Error validating organization code: ${error.message}`);
    }
  }

  /**
   * Validate organization ID
   * @param {string} organizationId - Organization ID to validate
   * @returns {Object} - Organization data if valid, null otherwise
   */
  async validateOrganizationId(organizationId) {
    try {
      const organization = await Organization.findById(organizationId);
      return organization;
    } catch (error) {
      throw new Error(`Error validating organization ID: ${error.message}`);
    }
  }

  /**
   * Create new user account
   * @param {Object} userData - User registration data
   * @returns {Object} - Created user data
   */
  async createUser(userData) {
    try {
      // Create user instance with plain password (model handles hashing)
      const newUser = new User({
        email: userData.email,
        password: userData.password, // Will be hashed by pre-save hook
        firstName: userData.firstName,
        lastName: userData.lastName,
        organizationCode: userData.organizationCode,
        organizationId: userData.organizationId,
        role: userData.role || 'user',
        roles: ['user'], // Ensure default role in array
        createdAt: new Date(),
        lastLogin: null,
        isActive: true,
        isEmailVerified: false
      });

      const savedUser = await newUser.save();

      // Create audit trail
      await auditService.createAuditLog({
        action: 'USER_CREATED',
        entityType: 'user',
        entityId: savedUser._id.toString(),
        userEmail: userData.email,
        organizationId: userData.organizationId,
        details: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          role: userData.role
        },
        timestamp: new Date()
      });

      return savedUser;
    } catch (error) {
      throw new Error(`Error creating user: ${error.message}`);
    }
  }

  /**
   * Authenticate user login
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Object} - User data if authentication successful
   */
  async authenticateUser(email, password) {
    try {
      // Explicitly select password since it's now excluded by default
      const user = await User.findOne({ email: email }).select('+password');

      if (!user) {
        throw new Error('User not found');
      }

      if (!user.isActive) {
        throw new Error('User account is deactivated');
      }

      // Verify password using instance method
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Get organization details
      const organization = await Organization.findById(user.organizationId);

      // Create audit trail
      await auditService.createAuditLog({
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: user._id.toString(),
        userEmail: email,
        organizationId: user.organizationId,
        details: {
          loginTime: new Date(),
          ipAddress: null // Will be set by controller
        },
        timestamp: new Date()
      });

      return {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
          lastLogin: user.lastLogin
        },
        organization: organization
      };
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get user photo data
   * @param {string} email - User email
   * @returns {Object} - Photo data if exists
   */
  async getUserPhoto(email) {
    try {
      const user = await User.findOne(
        { email: email },
        'photo'
      );

      if (!user || !user.photo) {
        return null;
      }

      return user.photo;
    } catch (error) {
      throw new Error(`Error getting user photo: ${error.message}`);
    }
  }

  /**
   * Upload user photo
   * @param {string} email - User email
   * @param {Buffer} photoData - Photo buffer data
   * @param {string} contentType - Photo content type
   * @returns {boolean} - Success status
   */
  async uploadUserPhoto(email, photoData, contentType) {
    try {
      const result = await User.updateOne(
        { email: email },
        {
          $set: {
            photo: {
              data: photoData,
              contentType: contentType,
              uploadedAt: new Date()
            }
          }
        }
      );

      if (result.matchedCount === 0) {
        throw new Error('User not found');
      }

      // Create audit trail
      const user = await this.checkEmailExists(email);
      await auditService.createAuditLog({
        action: 'PHOTO_UPLOADED',
        entityType: 'user',
        entityId: user._id.toString(),
        userEmail: email,
        organizationId: user.organizationId,
        details: {
          contentType: contentType,
          size: photoData.length
        },
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      throw new Error(`Error uploading photo: ${error.message}`);
    }
  }

  /**
   * Get user password salt
   * @param {string} email - User email
   * @returns {string} - Password salt
   */
  async getUserSalt(email) {
    try {
      const user = await User.findOne(
        { email: email },
        'password'
      );

      if (!user) {
        throw new Error('User not found');
      }

      // Extract salt from stored password (last 64 characters)
      // Password format: hash(64 chars) + salt(64 chars)
      if (!user.password || user.password.length < 64) {
        throw new Error('Invalid password format');
      }

      const salt = user.password.slice(-64); // Last 64 characters
      return salt;
    } catch (error) {
      throw new Error(`Error getting user salt: ${error.message}`);
    }
  }

  /**
   * Generate and store OTP for password reset
   * @param {string} email - User email
   * @returns {string} - Generated OTP
   */
  async generateOTP(email) {
    try {
      const user = await this.checkEmailExists(email);

      if (!user) {
        throw new Error('User not found');
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await User.updateOne(
        { email: email },
        {
          $set: {
            otp: otp,
            otpExpiry: otpExpiry,
            otpUsed: false
          }
        }
      );

      // Send OTP via Email
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #4CAF50;">Password Reset Request</h2>
          <p>You requested to reset your password. Use the OTP below to verify your identity.</p>
          <div style="margin: 20px 0; padding: 10px; background-color: #f4f4f4; border-radius: 5px; display: inline-block;">
            <strong style="font-size: 28px; letter-spacing: 5px; color: #333;">${otp}</strong>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #777; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
      `;

      await emailService.sendEmail(email, 'Your OTP Code - CareNest', emailHtml);

      // Create audit trail
      await auditService.createAuditLog({
        action: 'OTP_GENERATED',
        entityType: 'user',
        entityId: user._id.toString(),
        userEmail: email,
        organizationId: user.organizationId,
        details: {
          otpExpiry: otpExpiry
        },
        timestamp: new Date()
      });

      return otp;
    } catch (error) {
      console.error('Error in generateOTP:', error);
      throw new Error(`Error generating OTP: ${error.message}`);
    }
  }

  /**
   * Verify OTP for password reset
   * @param {string} email - User email
   * @param {string} otp - OTP to verify
   * @param {Object} options - Verification options
   * @param {boolean} options.preventConsumption - If true, do not mark OTP as used
   * @param {boolean} options.allowAlreadyUsed - If true, allow verification even if already used
   * @returns {boolean} - Verification status
   */
  async verifyOTP(email, otp, options = {}) {
    try {
      const user = await User.findOne({ email: email });

      if (!user) {
        throw new Error('User not found');
      }

      // Check if OTP exists
      if (!user.otp) {
        throw new Error('No valid OTP found');
      }

      // Check if used (unless we allow already used OTPs)
      if (user.otpUsed && !options.allowAlreadyUsed) {
        throw new Error('No valid OTP found'); // Maintain same error message for security/consistency
      }

      if (new Date() > user.otpExpiry) {
        throw new Error('OTP has expired');
      }

      // Ensure strict string comparison to handle cases where frontend sends number
      if (String(user.otp).trim() !== String(otp).trim()) {
        throw new Error('Invalid OTP');
      }

      // Mark OTP as used (unless prevented)
      if (!options.preventConsumption && !user.otpUsed) {
        await User.updateOne(
          { email: email },
          { $set: { otpUsed: true } }
        );

        // Create audit trail only on first consumption
        await auditService.createAuditLog({
          action: 'OTP_VERIFIED',
          entityType: 'user',
          entityId: user._id.toString(),
          userEmail: email,
          organizationId: user.organizationId,
          details: {},
          timestamp: new Date()
        });
      }

      return true;
    } catch (error) {
      throw new Error(`OTP verification failed: ${error.message}`);
    }
  }

  /**
   * Update user password
   * @param {string} email - User email
   * @param {string} newPassword - New password
   * @returns {boolean} - Update status
   */
  async updatePassword(email, newPassword) {
    try {
      const user = await this.checkEmailExists(email);

      if (!user) {
        throw new Error('User not found');
      }

      // Generate new salt and hash password
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedPassword = bcrypt.hashSync(newPassword, 10);

      await User.updateOne(
        { email: email },
        {
          $set: {
            password: hashedPassword,
            salt: salt,
            passwordUpdatedAt: new Date()
          },
          $unset: {
            otp: '',
            otpExpiry: '',
            otpUsed: ''
          }
        }
      );

      // Create audit trail
      await auditService.createAuditLog({
        action: 'PASSWORD_UPDATED',
        entityType: 'user',
        entityId: user._id.toString(),
        userEmail: email,
        organizationId: user.organizationId,
        details: {
          passwordUpdatedAt: new Date()
        },
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      throw new Error(`Error updating password: ${error.message}`);
    }
  }

  /**
   * Get user initial data
   * @param {string} email - User email
   * @returns {Object} - User initial data
   */
  async getInitData(email) {
    try {
      const user = await User.findOne({
        email: email,
        isActive: true
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Get organization details if user belongs to one
      let organizationDetails = null;
      if (user.organizationId) {
        organizationDetails = await Organization.findById(user.organizationId);
      }

      return {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        organization: organizationDetails ? {
          id: organizationDetails._id.toString(),
          name: organizationDetails.name,
          code: organizationDetails.organizationCode
        } : null
      };

    } catch (error) {
      throw new Error(`Error getting user initial data: ${error.message}`);
    }
  }
}

module.exports = new AuthService();
