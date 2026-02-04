const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');
const authService = require('../services/authService');
const SecureErrorHandler = require('../utils/errorHandler');
const { messaging } = require('../firebase-admin-config');

/**
 * Secure Authentication Controller
 * Handles all authentication operations with comprehensive security measures
 * Migrated to Mongoose and authService
 */
class SecureAuthController {
  /**
   * User registration with enhanced security
   */
  register = catchAsync(async (req, res) => {
    // 1. VALIDATION CHECK (express-validator)
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Validation failed',
          400,
          'VALIDATION_ERROR',
          errors.array()
        )
      );
    }

    const { email, password, confirmPassword, firstName, lastName, organizationCode, organizationId, phone } = req.body;

    // 2. LOGIC CHECK
    if (password !== confirmPassword) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Passwords do not match',
          400,
          'PASSWORD_MISMATCH'
        )
      );
    }

    // 3. CHECK EXISTANCE
    const existingUser = await authService.checkEmailExists(email);
    if (existingUser) {
      return res.status(409).json(
        SecureErrorHandler.createErrorResponse(
          'User with this email already exists',
          409,
          'USER_EXISTS'
        )
      );
    }

    // 4. CREATE USER
    const newUser = await authService.createUser({
      email,
      password,
      firstName,
      lastName,
      organizationCode,
      organizationId: organizationId || null,
      phone: phone || null,
      role: 'user'
    });

    // 5. GENERATE OTP
    await authService.generateOTP(email);

    logger.business('User registered', {
      action: 'USER_REGISTERED',
      userId: newUser._id.toString(),
      email: newUser.email,
      ip: req.ip
    });

    res.status(201).json(
      SecureErrorHandler.createSuccessResponse(
        {
          userId: newUser._id.toString(),
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName
        },
        'User registered successfully. Please verify your email.'
      )
    );
  });

  /**
   * Register FCM Token for push notifications
   */
  registerFcmToken = catchAsync(async (req, res) => {
    const email = req.body?.email || req.body?.userEmail;
    let { organizationId, fcmToken, deviceId, deviceInfo } = req.body || {};

    if (!email || !fcmToken) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Email and FCM Token are required',
          400,
          'MISSING_FIELDS'
        )
      );
    }

    // Validate FCM token format basic check
    if (typeof fcmToken !== 'string' || fcmToken.trim() === '') {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Invalid FCM token provided',
          400,
          'INVALID_FCM_TOKEN'
        )
      );
    }

    const user = await User.findOne(
      organizationId ? { email: email, organizationId } : { email: email }
    ).select('email organizationId');

    if (!user) {
      return res.status(404).json(
        SecureErrorHandler.createErrorResponse(
          'User not found',
          404,
          'USER_NOT_FOUND'
        )
      );
    }

    if (!organizationId) {
      organizationId = user.organizationId;
    }

    // Verify token with Firebase
    try {
      await messaging.send(
        {
          token: fcmToken,
          data: { type: 'token_verification' },
          android: { priority: 'normal' },
          apns: { headers: { 'apns-priority': '5' } }
        },
        true
      );
    } catch (error) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          `Invalid FCM token: ${error.message}`,
          400,
          'INVALID_FCM_TOKEN'
        )
      );
    }

    // Handle old token clean up
    const existingToken = await FcmToken.findOne({ fcmToken: fcmToken });
    if (
      existingToken &&
      (existingToken.userEmail !== email || existingToken.organizationId?.toString() !== organizationId?.toString())
    ) {
      await FcmToken.deleteOne({ fcmToken: fcmToken });
    }

    const fcmTokenFilter =
      deviceId && typeof deviceId === 'string' && deviceId.trim() !== ''
        ? { userEmail: email, organizationId, deviceId: deviceId }
        : { userEmail: email, organizationId };

    await FcmToken.updateOne(
      fcmTokenFilter,
      {
        $set: {
          fcmToken: fcmToken,
          updatedAt: new Date(),
          lastValidated: new Date(),
          deviceId: deviceId || null,
          deviceInfo: deviceInfo || null
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    // Ensure token not associated with others
    await User.updateMany(
      { fcmToken: fcmToken, email: { $ne: email } },
      { $unset: { fcmToken: "" } }
    );

    // Update user
    await User.updateOne(
      { email: email },
      {
        $set: {
          fcmToken: fcmToken,
          lastFcmUpdate: new Date(),
          deviceId: deviceId || null,
          deviceInfo: deviceInfo || null
        }
      }
    );

    logger.business('FCM token registered', {
      action: 'FCM_TOKEN_REGISTERED',
      email,
      organizationId,
      deviceId
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        { updated: true },
        'FCM token registered successfully'
      )
    );
  });

  /**
   * User login with enhanced security
   */
  login = catchAsync(async (req, res) => {
    // 1. VALIDATION CHECK (express-validator)
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Validation failed',
          400,
          'VALIDATION_ERROR',
          errors.array()
        )
      );
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Email and password are required',
          400,
          'MISSING_CREDENTIALS'
        )
      );
    }

    // 2. FIND USER
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +loginAttempts +lockUntil');

    if (!user) {
      logger.business('Login attempt with non-existent email', {
        action: 'LOGIN_FAILED',
        reason: 'NON_EXISTENT_EMAIL',
        ip: req.ip,
        email
      });
      return res.status(401).json(
        SecureErrorHandler.createErrorResponse(
          SecureErrorHandler.GENERIC_AUTH_ERROR,
          401,
          'INVALID_CREDENTIALS'
        )
      );
    }

    // 3. CHECK LOCKOUT
    if (user.lockUntil && user.lockUntil > new Date()) {
      logger.business('Login attempt on locked account', {
        action: 'LOGIN_FAILED',
        reason: 'ACCOUNT_LOCKED',
        ip: req.ip,
        email: user.email
      });
      return res.status(423).json(
        SecureErrorHandler.createErrorResponse(
          'Account is temporarily locked due to multiple failed login attempts',
          423,
          'ACCOUNT_LOCKED'
        )
      );
    }

    if (!user.isActive) {
      return res.status(403).json(
        SecureErrorHandler.createErrorResponse(
          'Account is deactivated',
          403,
          'ACCOUNT_DISABLED'
        )
      );
    }

    // 4. VERIFY PASSWORD
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      // Increment attempts
      const maxAttempts = 5;
      const lockDuration = 30 * 60 * 1000; // 30 mins

      const updates = { $inc: { loginAttempts: 1 } };

      // If attempts will exceed max, lock
      if ((user.loginAttempts || 0) + 1 >= maxAttempts) {
        updates.$set = { lockUntil: new Date(Date.now() + lockDuration), loginAttempts: 0 };
        delete updates.$inc;
      }

      await User.updateOne({ _id: user._id }, updates);

      logger.business('Failed login attempt', {
        action: 'LOGIN_FAILED',
        reason: 'INVALID_PASSWORD',
        ip: req.ip,
        email: user.email,
        attempts: user.loginAttempts + 1
      });

      return res.status(401).json(
        SecureErrorHandler.createErrorResponse(
          SecureErrorHandler.GENERIC_AUTH_ERROR,
          401,
          'INVALID_CREDENTIALS'
        )
      );
    }

    // 5. SUCCESS
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLogin = new Date();
    await user.save();

    // 6. TOKEN
    const tokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles || ['user'],
      organizationId: user.organizationId
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: 'invoice-app',
        audience: 'invoice-app-users'
      }
    );

    logger.business('User logged in', {
      action: 'USER_LOGIN',
      userId: user._id.toString(),
      email: user.email,
      ip: req.ip
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        {
          token,
          user: user.toJSON()
        },
        'Login successful'
      )
    );
  });

  /**
   * Email verification
   */
  verifyEmail = catchAsync(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Email and OTP are required',
          400,
          'MISSING_FIELDS'
        )
      );
    }

    // Use authService to verify
    await authService.verifyOTP(email, otp);

    // Update user status
    await User.updateOne(
      { email: email },
      { $set: { isEmailVerified: true, updatedAt: new Date() } }
    );

    logger.business('Email verified', {
      action: 'EMAIL_VERIFIED',
      email,
      ip: req.ip
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        null,
        'Email verified successfully'
      )
    );
  });

  /**
   * Password reset request
   */
  requestPasswordReset = catchAsync(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Email is required',
          400,
          'MISSING_FIELDS'
        )
      );
    }

    // Check if user exists (silent fail if not to prevent enumeration)
    const user = await authService.checkEmailExists(email);

    if (user) {
      await authService.generateOTP(email);
      logger.business('Password reset OTP generated', {
        action: 'PASSWORD_RESET_REQUESTED',
        email,
        ip: req.ip
      });
    } else {
      logger.business('Password reset requested for non-existent email', {
        action: 'PASSWORD_RESET_NONEXISTENT',
        ip: req.ip,
        email
      });
    }

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        null,
        'If an account with this email exists, a password reset code has been sent.'
      )
    );
  });

  /**
   * Password reset confirmation (Reset Password)
   */
  resetPassword = catchAsync(async (req, res) => {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'All fields required',
          400,
          'MISSING_FIELDS'
        )
      );
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Passwords do not match',
          400,
          'PASSWORD_MISMATCH'
        )
      );
    }

    // Verify OTP via authService
    try {
      // Allow already used OTPs to handle cases where frontend verifies before reset
      await authService.verifyOTP(email, otp, { allowAlreadyUsed: true });
    } catch (error) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          error.message || 'Invalid or expired OTP',
          400,
          'INVALID_OTP'
        )
      );
    }

    try {
      // Use authService to update password (handles hashing, salt, and OTP cleanup)
      await authService.updatePassword(email, newPassword);

      // Unlock account (reset login attempts)
      await User.updateOne(
        { email: email },
        { 
          $set: { 
            loginAttempts: 0, 
            lockUntil: undefined 
          } 
        }
      );

      logger.business('Password reset', {
        action: 'PASSWORD_RESET',
        email,
        ip: req.ip
      });

      res.status(200).json(
        SecureErrorHandler.createSuccessResponse(
          null,
          'Password reset successfully'
        )
      );
    } catch (error) {
      return res.status(500).json(
        SecureErrorHandler.createErrorResponse(
          `Error resetting password: ${error.message}`,
          500,
          'INTERNAL_ERROR'
        )
      );
    }
  });

  /**
   * Get user profile
   */
  getProfile = catchAsync(async (req, res) => {
    const { userId } = req.user;
    const user = await User.findOne({ _id: userId }).select('-password -loginAttempts -lockUntil -__v');

    if (!user) {
      return res.status(404).json(
        SecureErrorHandler.createErrorResponse(
          'User not found',
          404,
          'USER_NOT_FOUND'
        )
      );
    }

    logger.business('Profile retrieved', {
      action: 'PROFILE_RETRIEVED',
      userId
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        user,
        'Profile retrieved successfully'
      )
    );
  });

  /**
   * Logout user
   */
  logout = catchAsync(async (req, res) => {
    logger.business('User logged out', {
      action: 'USER_LOGOUT',
      userId: req.user?.userId,
      ip: req.ip
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        null,
        'Logged out successfully'
      )
    );
  });

  /**
   * Assign Job Role
   */
  assignJobRole = catchAsync(async (req, res) => {
    const { userId, jobRoleTitle } = req.body;

    if (!userId || !jobRoleTitle) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Missing fields: userId and jobRoleTitle are required',
          400,
          'MISSING_FIELDS'
        )
      );
    }

    const result = await User.updateOne(
      { _id: userId },
      { $set: { jobRole: jobRoleTitle, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json(
        SecureErrorHandler.createErrorResponse(
          'User not found',
          404,
          'USER_NOT_FOUND'
        )
      );
    }

    logger.business('Job role assigned', {
      action: 'JOB_ROLE_ASSIGNED',
      userId,
      jobRole: jobRoleTitle
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        { userId, jobRole: jobRoleTitle },
        'Job role assigned successfully'
      )
    );
  });

  /**
   * Refresh Token
   */
  refreshToken = catchAsync(async (req, res) => {
    const { userId } = req.user;
    const user = await User.findOne({ _id: userId });

    if (!user) {
      return res.status(404).json(
        SecureErrorHandler.createErrorResponse(
          'User not found',
          404,
          'USER_NOT_FOUND'
        )
      );
    }

    const tokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles || ['user'],
      organizationId: user.organizationId
    };

    const newToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: 'invoice-app',
        audience: 'invoice-app-users'
      }
    );

    logger.business('Token refreshed', {
      action: 'TOKEN_REFRESHED',
      userId: user._id.toString()
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        { token: newToken },
        'Token refreshed'
      )
    );
  });

  /**
   * Verify Token
   */
  verifyToken = catchAsync(async (req, res) => {
    // Middleware already verified token
    logger.business('Token verified', {
      action: 'TOKEN_VERIFIED',
      userId: req.user?.userId
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        { valid: true, user: req.user },
        'Token is valid'
      )
    );
  });

  /**
   * Change Password
   */
  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const { userId } = req.user;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'All fields required',
          400,
          'MISSING_FIELDS'
        )
      );
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json(
        SecureErrorHandler.createErrorResponse(
          'Passwords do not match',
          400,
          'PASSWORD_MISMATCH'
        )
      );
    }

    const user = await User.findOne({ _id: userId }).select('+password');
    if (!user) {
      return res.status(404).json(
        SecureErrorHandler.createErrorResponse(
          'User not found',
          404,
          'USER_NOT_FOUND'
        )
      );
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json(
        SecureErrorHandler.createErrorResponse(
          'Incorrect current password',
          401,
          'INVALID_PASSWORD'
        )
      );
    }

    user.password = newPassword;
    await user.save();

    logger.business('Password changed', {
      action: 'PASSWORD_CHANGED',
      userId
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        null,
        'Password changed successfully'
      )
    );
  });

  /**
   * Update Profile
   */
  updateProfile = catchAsync(async (req, res) => {
    const { userId } = req.user;
    const updates = req.body;

    delete updates.password;
    delete updates.email;
    delete updates.roles;
    delete updates.organizationId;
    delete updates._id;

    const result = await User.updateOne(
      { _id: userId },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json(
        SecureErrorHandler.createErrorResponse(
          'User not found',
          404,
          'USER_NOT_FOUND'
        )
      );
    }

    logger.business('Profile updated', {
      action: 'PROFILE_UPDATED',
      userId
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        null,
        'Profile updated'
      )
    );
  });

  /**
   * Deactivate Account
   */
  deactivateAccount = catchAsync(async (req, res) => {
    const { userId } = req.user;

    await User.updateOne(
      { _id: userId },
      { $set: { isActive: false } }
    );

    logger.business('Account deactivated', {
      action: 'ACCOUNT_DEACTIVATED',
      userId
    });

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        null,
        'Account deactivated'
      )
    );
  });
}

module.exports = new SecureAuthController();
