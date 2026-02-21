const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Client = require('../models/Client');
const Organization = require('../models/Organization');
const UserOrganization = require('../models/UserOrganization');
const auditService = require('./auditService');
const emailService = require('./emailService');

/**
 * Get auth collection (login collection)
 * @returns {Collection} MongoDB collection
 */
function getAuthCollection() {
  const mongoose = require('mongoose');
  return mongoose.connection.collection('login');
}

/**
 * Get users collection
 * @returns {Collection} MongoDB collection
 */
function getUsersCollection() {
  const mongoose = require('mongoose');
  return mongoose.connection.collection('users');
}

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
      const isFirebaseUser = !!userData.firebaseUid;
      
      const newUser = new User({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        abn: userData.abn,
        organizationCode: userData.organizationCode,
        organizationId: userData.organizationId,
        role: userData.role || 'user',
        roles: ['user'],
        createdAt: new Date(),
        lastLogin: null,
        isActive: true,
        isEmailVerified: isFirebaseUser ? true : false,
        // Firebase-specific fields
        ...(isFirebaseUser && {
          firebaseUid: userData.firebaseUid,
          firebaseSyncedAt: userData.firebaseSyncedAt || new Date(),
          emailVerified: userData.emailVerified !== undefined ? userData.emailVerified : true
        }),
        // Password only for non-Firebase users
        ...(!isFirebaseUser && { password: userData.password })
      });

      const savedUser = await newUser.save();

      // Create UserOrganization record (Zero-Trust requirement)
      if (userData.organizationId) {
        try {
          await UserOrganization.create({
            userId: savedUser._id.toString(),
            organizationId: userData.organizationId,
            role: userData.role || 'user',
            permissions: (userData.role === 'admin' || userData.role === 'owner') ? ['*'] : ['read', 'write'],
            isActive: true,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } catch (orgError) {
          console.error('Failed to create UserOrganization record:', orgError.message);
          // Don't fail user creation, but log the error
        }
      }

      // Create audit trail only if organizationId exists (for owners creating new orgs, this happens later)
      if (userData.organizationId) {
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
      }

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
      // 1. Get auth credentials from login collection
      const authCollection = getAuthCollection();
      const authData = await authCollection.findOne({ email: email });

      if (!authData) {
        throw new Error('User not found');
      }

      // 2. Check if account is active (from auth data or user profile)
      const usersCollection = getUsersCollection();
      const userProfile = await usersCollection.findOne({ email: email });
      
      if (userProfile && userProfile.isActive === false) {
        throw new Error('User account is deactivated');
      }

      // 3. Verify password using bcrypt
      if (!authData.password || !authData.password.startsWith('$2')) {
        throw new Error('Invalid password format');
      }

      const isPasswordValid = await bcrypt.compare(password, authData.password);
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }

      // 4. Get user profile from users collection
      const user = await usersCollection.findOne({ email: email });
      
      if (!user) {
        throw new Error('User profile not found');
      }

      // 5. Update last login in auth collection
      await authCollection.updateOne(
        { email: email },
        { $set: { lastLogin: new Date() } }
      );

      // 6. Get organization details
      const organization = await Organization.findById(user.organizationId);

      // 7. Create audit trail
      await auditService.createAuditLog({
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: user._id?.toString() || user.email,
        userEmail: email,
        organizationId: user.organizationId,
        details: {
          loginTime: new Date()
        },
        timestamp: new Date()
      });

      // 8. Return combined auth + profile data
      return {
        auth: {
          email: authData.email,
          lastLogin: authData.lastLogin
        },
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName,
          phone: user.phone,
          photo: user.photo,
          photoUrl: user.photoUrl,
          role: user.role,
          roles: user.roles || (user.role ? [user.role] : ['user']),
          organizationId: user.organizationId,
          organizationCode: user.organizationCode,
          organizationName: user.organizationName,
          jobRole: user.jobRole,
          employmentType: user.employmentType,
          classificationLevel: user.classificationLevel,
          payPoint: user.payPoint,
          stream: user.stream,
          payRate: user.payRate || 0,
          rates: user.rates || {},
          activeAllowances: user.activeAllowances || [],
          payType: user.payType,
          abn: user.abn,
          multiOrgEnabled: user.multiOrgEnabled || false,
          defaultOrganizationId: user.defaultOrganizationId,
          lastActiveOrganizationId: user.lastActiveOrganizationId,
          isActive: user.isActive !== false,
          isEmailVerified: user.isEmailVerified || false,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastLogin: user.lastLogin
        },
        organization: organization
      };
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get user photo data (R2 Only - returns URL)
   * @param {string} email - User email
   * @returns {Object} - { type: 'url', url: string }
   */
  async getUserPhoto(email) {
    try {
      const user = await User.findOne(
        { email: email },
        'photoUrl profilePic'
      );

      if (!user) {
        return null;
      }

      // 1. Check for R2 URL (photoUrl or profilePic)
      if (user.photoUrl) {
        return { type: 'url', url: user.photoUrl };
      }
      if (user.profilePic && (user.profilePic.startsWith('http') || user.profilePic.startsWith('/'))) {
        return { type: 'url', url: user.profilePic };
      }

      // Legacy buffer fallback removed as requested.
      return null;
    } catch (error) {
      throw new Error(`Error getting user photo: ${error.message}`);
    }
  }

  /**
   * Upload user photo (R2/URL only)
   * @param {string} email - User email
   * @param {string} photoUrl - Photo URL (from R2)
   * @param {string} contentType - Photo content type
   * @returns {boolean} - Success status
   */
  async uploadUserPhoto(email, photoUrl, contentType) {
    try {
      const result = await User.updateOne(
        { email: email },
        {
          $set: {
            photoUrl: photoUrl,
            profilePic: photoUrl, // Compatibility alias
            photoUpdatedAt: new Date()
          },
          $unset: {
            photo: "" // Remove legacy buffer field to enforce R2 usage
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
          url: photoUrl
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
   * @param {string} purpose - Purpose of OTP ('verification' or 'reset')
   * @returns {string} - Generated OTP
   */
  async generateOTP(email, purpose = 'reset') {
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

      // Email content based on purpose
      let emailSubject, emailHtml;
      
      if (purpose === 'verification') {
        emailSubject = 'Verify Your Email - CareNest';
        emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #4CAF50;">Welcome to CareNest!</h2>
            <p>Thank you for creating your account. Please verify your email address using the code below.</p>
            <div style="margin: 20px 0; padding: 10px; background-color: #f4f4f4; border-radius: 5px; display: inline-block;">
              <strong style="font-size: 28px; letter-spacing: 5px; color: #333;">${otp}</strong>
            </div>
            <p>This verification code will expire in 10 minutes.</p>
            <p style="color: #777; font-size: 12px;">If you did not create an account, please ignore this email.</p>
          </div>
        `;
      } else {
        emailSubject = 'Your OTP Code - CareNest';
        emailHtml = `
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
      }

      await emailService.sendEmail(email, emailSubject, emailHtml);

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
