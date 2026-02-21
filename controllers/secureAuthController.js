const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const User = require('../models/User');
const FcmToken = require('../models/FcmToken');
const UserOrganization = require('../models/UserOrganization');
const Organization = require('../models/Organization');
const authService = require('../services/authService');
const SecureErrorHandler = require('../utils/errorHandler');
const { admin, messaging } = require('../firebase-admin-config');
const keyRotationService = require('../services/jwtKeyRotationService');

/**
 * Secure Authentication Controller
 * Handles all authentication operations with comprehensive security measures
 * Migrated to Mongoose and authService
 */
class SecureAuthController {
  /**
   * User registration with enhanced security
   * Creates Firebase user via Admin SDK and MongoDB user
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

    const { email, password, confirmPassword, firstName, lastName, organizationCode, organizationId, organizationName, isOwner, phone } = req.body;

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

    // 3. CHECK EXISTENCE — handle orphaned states from prior partial failures
    const existingMongoUser = await authService.checkEmailExists(email);

    if (existingMongoUser) {
      // If MongoDB user exists WITH a firebaseUid — fully registered, reject
      if (existingMongoUser.firebaseUid) {
        return res.status(409).json(
          SecureErrorHandler.createErrorResponse(
            'User with this email already exists',
            409,
            'USER_EXISTS'
          )
        );
      }

      // MongoDB user exists WITHOUT firebaseUid — orphaned record from a prior partial failure.
      // Delete it so the registration can proceed cleanly.
      logger.warn('Deleting orphaned MongoDB user (no firebaseUid)', { email });
      await existingMongoUser.deleteOne();
    }

    // 4. CREATE FIREBASE USER via Admin SDK
    // Also handle the case where Firebase already has this user (orphaned Firebase record)
    let firebaseUser;
    let customToken;
    try {
      firebaseUser = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: `${firstName} ${lastName}`,
        emailVerified: false
      });

      // Generate custom token for client to sign in
      customToken = await admin.auth().createCustomToken(firebaseUser.uid);

      logger.info('Firebase user created via Admin SDK', {
        email,
        firebaseUid: firebaseUser.uid
      });
    } catch (firebaseError) {
      logger.error('Failed to create Firebase user', {
        email,
        error: firebaseError.message,
        code: firebaseError.code
      });

      if (firebaseError.code === 'auth/email-already-exists') {
        // Firebase has this user but MongoDB doesn't (we just cleaned up above).
        // Delete the orphaned Firebase user and retry once.
        try {
          const existingFirebaseUser = await admin.auth().getUserByEmail(email);
          await admin.auth().deleteUser(existingFirebaseUser.uid);
          logger.warn('Deleted orphaned Firebase user, retrying creation', { email });

          firebaseUser = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: `${firstName} ${lastName}`,
            emailVerified: false
          });
          customToken = await admin.auth().createCustomToken(firebaseUser.uid);

          logger.info('Firebase user re-created after orphan cleanup', {
            email,
            firebaseUid: firebaseUser.uid
          });
        } catch (retryError) {
          logger.error('Failed to re-create Firebase user after orphan cleanup', {
            email,
            error: retryError.message
          });
          return res.status(500).json(
            SecureErrorHandler.createErrorResponse(
              'Failed to create user account. Please try again.',
              500,
              'FIREBASE_ERROR'
            )
          );
        }
      } else {
        return res.status(500).json(
          SecureErrorHandler.createErrorResponse(
            'Failed to create user account',
            500,
            'FIREBASE_ERROR'
          )
        );
      }
    }

    // 5. CREATE MONGODB USER — roll back Firebase user if this fails
    let newUser;
    try {
      newUser = await authService.createUser({
        email,
        firstName,
        lastName,
        abn: req.body.abn,
        organizationCode,
        organizationId: organizationId || null,
        phone: phone || null,
        role: isOwner ? 'admin' : 'user',
        firebaseUid: firebaseUser.uid,
        firebaseSyncedAt: new Date(),
        emailVerified: false
      });
    } catch (mongoError) {
      // Roll back Firebase user to keep systems in sync
      logger.error('MongoDB user creation failed — rolling back Firebase user', {
        email,
        firebaseUid: firebaseUser.uid,
        error: mongoError.message
      });
      try {
        await admin.auth().deleteUser(firebaseUser.uid);
        logger.info('Firebase user rolled back successfully', { email });
      } catch (rollbackError) {
        logger.error('Failed to roll back Firebase user', {
          email,
          firebaseUid: firebaseUser.uid,
          error: rollbackError.message
        });
      }
      return res.status(500).json(
        SecureErrorHandler.createErrorResponse(
          'Failed to create user account. Please try again.',
          500,
          'REGISTRATION_FAILED'
        )
      );
    }

    let createdOrganization = null;

    // 6. AUTO-CREATE ORGANIZATION FOR OWNERS (Fresh Start Feature)
    if (isOwner || (!organizationId && !organizationCode)) {
      try {
        // Generate unique 6-character organization code
        const generateOrgCode = () => {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let code = '';
          for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          return code;
        };

        let orgCode = generateOrgCode();
        // Ensure uniqueness
        while (await Organization.findOne({ code: orgCode })) {
          orgCode = generateOrgCode();
        }

        createdOrganization = await Organization.create({
          name: organizationName || `${firstName} ${lastName}'s Organization`,
          code: orgCode,
          ownerEmail: email,
          contactDetails: {
            email: email,
            phone: phone || null
          },
          isActive: true,
          createdAt: new Date()
        });

        // Update user with organization ID
        newUser.organizationId = createdOrganization._id.toString();
        newUser.organizationCode = orgCode;
        newUser.role = 'admin';
        await newUser.save();

        // Create UserOrganization with owner role
        await UserOrganization.create({
          userId: newUser._id.toString(),
          organizationId: createdOrganization._id.toString(),
          role: 'owner',
          permissions: ['all'],
          isActive: true,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Create audit log after organization is created
        const auditService = require('../services/auditService');
        try {
          await auditService.createAuditLog({
            action: 'USER_CREATED',
            entityType: 'user',
            entityId: newUser._id.toString(),
            userEmail: email,
            organizationId: createdOrganization._id.toString(),
            details: {
              email: email,
              firstName: firstName,
              lastName: lastName,
              role: 'admin',
              organizationCreated: true,
              organizationCode: orgCode
            },
            timestamp: new Date()
          });
        } catch (auditError) {
          logger.warn('Audit log creation failed (non-fatal)', {
            userId: newUser._id.toString(),
            error: auditError.message
          });
        }

        logger.info('Auto-created organization for new owner', {
          userId: newUser._id.toString(),
          organizationId: createdOrganization._id.toString(),
          organizationCode: orgCode
        });
      } catch (orgError) {
        logger.error('Failed to auto-create organization', {
          userId: newUser._id.toString(),
          error: orgError.message
        });
        // Don't fail registration — user can set up org later
      }
    }
    // 7. CREATE USER ORGANIZATION RECORD for members joining an existing org
    else if (organizationId) {
      try {
        await UserOrganization.create({
          userId: newUser._id.toString(),
          organizationId: organizationId,
          role: 'user',
          permissions: ['read', 'write'],
          isActive: true,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Create audit log for member joining existing org
        const auditService = require('../services/auditService');
        try {
          await auditService.createAuditLog({
            action: 'USER_CREATED',
            entityType: 'user',
            entityId: newUser._id.toString(),
            userEmail: email,
            organizationId: organizationId,
            details: {
              email: email,
              firstName: firstName,
              lastName: lastName,
              role: 'user',
              joinedExistingOrg: true
            },
            timestamp: new Date()
          });
        } catch (auditError) {
          logger.warn('Audit log creation failed (non-fatal)', {
            userId: newUser._id.toString(),
            error: auditError.message
          });
        }

        logger.info('UserOrganization record created', {
          userId: newUser._id.toString(),
          organizationId: organizationId
        });
      } catch (orgError) {
        logger.error('Failed to create UserOrganization record', {
          userId: newUser._id.toString(),
          organizationId: organizationId,
          error: orgError.message
        });
      }
    }

    // 8. GENERATE OTP for email verification
    try {
      await authService.generateOTP(email);
    } catch (otpError) {
      logger.warn('OTP generation failed (non-fatal)', { email, error: otpError.message });
    }

    logger.business('User registered', {
      action: 'USER_REGISTERED',
      userId: newUser._id.toString(),
      email: newUser.email,
      firebaseUid: firebaseUser.uid,
      ip: req.ip
    });

    res.status(201).json(
      SecureErrorHandler.createSuccessResponse(
        {
          userId: newUser._id.toString(),
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          firebaseUid: firebaseUser.uid,
          customToken: customToken,
          ...(createdOrganization && {
            organization: {
              id: createdOrganization._id.toString(),
              name: createdOrganization.name,
              code: createdOrganization.code
            }
          }),
          organizationId: newUser.organizationId
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
   * Uses separated collections: login (auth) + users (profile)
   */
  login = catchAsync(async (req, res) => {
    // 1. VALIDATION CHECK
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

    // 2. FIND AUTH CREDENTIALS (from login collection)
    const getAuthCollection = () => {
      const mongoose = require('mongoose');
      return mongoose.connection.collection('login');
    };
    const getUserCollection = () => {
      const mongoose = require('mongoose');
      return mongoose.connection.collection('users');
    };

    const authCollection = getAuthCollection();
    const userCollection = getUserCollection();

    const authData = await authCollection.findOne({ email: email.toLowerCase() });

    if (!authData) {
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
    if (authData.lockUntil && authData.lockUntil > new Date()) {
      logger.business('Login attempt on locked account', {
        action: 'LOGIN_FAILED',
        reason: 'ACCOUNT_LOCKED',
        ip: req.ip,
        email: authData.email
      });
      return res.status(423).json(
        SecureErrorHandler.createErrorResponse(
          'Account is temporarily locked due to multiple failed login attempts',
          423,
          'ACCOUNT_LOCKED'
        )
      );
    }

    // 4. CHECK USER STATUS (from users collection)
    const userProfile = await userCollection.findOne({ email: email.toLowerCase() });

    if (userProfile && userProfile.isActive === false) {
      return res.status(403).json(
        SecureErrorHandler.createErrorResponse(
          'Account is deactivated',
          403,
          'ACCOUNT_DISABLED'
        )
      );
    }

    // 5. VERIFY PASSWORD
    if (!authData.password || !authData.password.startsWith('$2')) {
      return res.status(401).json(
        SecureErrorHandler.createErrorResponse(
          SecureErrorHandler.GENERIC_AUTH_ERROR,
          401,
          'INVALID_CREDENTIALS'
        )
      );
    }

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, authData.password);

    if (!isMatch) {
      // Increment attempts
      const maxAttempts = 5;
      const lockDuration = 30 * 60 * 1000; // 30 mins

      const updates = { $inc: { loginAttempts: 1 } };

      // If attempts will exceed max, lock
      if ((authData.loginAttempts || 0) + 1 >= maxAttempts) {
        updates.$set = { lockUntil: new Date(Date.now() + lockDuration), loginAttempts: 0 };
        delete updates.$inc;
      }

      await authCollection.updateOne({ email: email.toLowerCase() }, updates);

      logger.business('Failed login attempt', {
        action: 'LOGIN_FAILED',
        reason: 'INVALID_PASSWORD',
        ip: req.ip,
        email: authData.email,
        attempts: (authData.loginAttempts || 0) + 1
      });

      return res.status(401).json(
        SecureErrorHandler.createErrorResponse(
          SecureErrorHandler.GENERIC_AUTH_ERROR,
          401,
          'INVALID_CREDENTIALS'
        )
      );
    }

    // 6. SUCCESS - Get user profile
    const user = await userCollection.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(500).json(
        SecureErrorHandler.createErrorResponse(
          'User profile not found',
          500,
          'PROFILE_NOT_FOUND'
        )
      );
    }

    // 7. Reset attempts and update last login
    await authCollection.updateOne(
      { email: email.toLowerCase() },
      { $set: { loginAttempts: 0, lockUntil: null, lastLogin: new Date() } }
    );

    // 8. Generate token
    const userRoles = user.roles && user.roles.length > 0
      ? user.roles
      : (user.role ? [user.role] : ['user']);

    const tokenPayload = {
      userId: user._id?.toString() || user.email,
      email: user.email,
      roles: userRoles,
      organizationId: user.organizationId
    };

    // Use key rotation service to get the current active key
    let token;
    try {
      const activeKey = await keyRotationService.getActiveKey();

      token = jwt.sign(
        tokenPayload,
        activeKey.secret,
        {
          expiresIn: process.env.JWT_EXPIRES_IN || '24h',
          issuer: 'invoice-app',
          audience: 'invoice-app-users',
          keyid: activeKey.keyId // Add key ID to JWT header for identification
        }
      );

      logger.info('Token generated with key rotation', {
        keyId: activeKey.keyId,
        userId: user._id?.toString()
      });
    } catch (error) {
      // Fallback to environment variable if key rotation service fails
      logger.warn('Key rotation service unavailable, falling back to JWT_SECRET', {
        error: error.message
      });

      token = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.JWT_EXPIRES_IN || '24h',
          issuer: 'invoice-app',
          audience: 'invoice-app-users'
        }
      );
    }

    logger.business('User logged in', {
      action: 'USER_LOGIN',
      userId: user._id?.toString() || user.email,
      email: user.email,
      ip: req.ip
    });

    // 9. Return user profile (not auth data)
    const responseUser = {
      id: user._id?.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      phone: user.phone,
      photo: user.photo,
      photoUrl: user.photoUrl,
      role: user.role,
      roles: userRoles,
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
    };

    res.status(200).json(
      SecureErrorHandler.createSuccessResponse(
        {
          token,
          user: responseUser
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

    // Handle both legacy 'role' and new 'roles' fields
    const userRoles = user.roles && user.roles.length > 0
      ? user.roles
      : (user.role ? [user.role] : ['user']);

    const tokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: userRoles,
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
