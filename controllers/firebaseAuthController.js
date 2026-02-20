const { admin } = require('../firebase-admin-config');
const { createLogger } = require('../utils/logger');
const User = require('../models/User');
const Organization = require('../models/Organization');
const UserOrganization = require('../models/UserOrganization');

const logger = createLogger('FirebaseAuthController');

class FirebaseAuthController {
  /**
   * Sync Firebase user with MongoDB after successful authentication
   * This endpoint is called after Firebase Auth succeeds on the client
   */
  static async syncUser(req, res) {
    try {
      const { firebaseUid, email, firstName, lastName, photoURL } = req.body;

      if (!firebaseUid || !email) {
        return res.status(400).json({
          success: false,
          message: 'Firebase UID and email are required'
        });
      }

      // Check if user already exists
      let user = await User.findOne({ firebaseUid });

      if (!user) {
        // Try to find by email (migration scenario - existing MongoDB user)
        user = await User.findOne({ email });
        
        if (user) {
          // Link existing user to Firebase
          user.firebaseUid = firebaseUid;
          user.firebaseSyncedAt = new Date();
          logger.info('Linked existing user to Firebase', {
            email,
            firebaseUid
          });
        } else {
          // Create new user - this is a Firebase-only signup
          // They won't have organizationId yet (will be assigned via signup flow or admin)
          user = new User({
            firebaseUid,
            email,
            firstName: firstName || '',
            lastName: lastName || '',
            photoURL,
            emailVerified: true,
            firebaseSyncedAt: new Date(),
            createdAt: new Date()
          });
          logger.info('Created new user from Firebase', {
            email,
            firebaseUid
          });
        }
      }

      // Update user data
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (photoURL) user.photoURL = photoURL;
      user.lastLoginAt = new Date();
      user.updatedAt = new Date();

      await user.save();

      // Fetch organization details if user has organizationId
      let organizationName = null;
      let organizationCode = null;
      
      if (user.organizationId) {
        try {
          const organization = await Organization.findById(user.organizationId);
          if (organization) {
            organizationName = organization.name;
            organizationCode = organization.code;
          }
        } catch (orgError) {
          logger.warn('Could not fetch organization details', {
            organizationId: user.organizationId,
            error: orgError.message
          });
        }
      }

      // Return user data (excluding sensitive fields)
      const userData = {
        _id: user._id,
        firebaseUid: user.firebaseUid,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: organizationName,
        organizationCode: organizationCode || user.organizationCode,
        photoURL: user.photoURL,
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt
      };

      return res.status(200).json({
        success: true,
        message: 'User synced successfully',
        data: userData
      });
    } catch (error) {
      logger.error('User sync failed', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to sync user data',
        error: error.message
      });
    }
  }

  /**
   * Get user data by Firebase UID
   */
  static async getUserByFirebaseUid(req, res) {
    try {
      const { firebaseUid } = req.params;

      const user = await User.findOne({ firebaseUid });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Return user data (excluding sensitive fields)
      const userData = {
        _id: user._id,
        firebaseUid: user.firebaseUid,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
        organizationCode: user.organizationCode,
        photoURL: user.photoURL,
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt
      };

      return res.status(200).json({
        success: true,
        data: userData
      });
    } catch (error) {
      logger.error('Get user failed', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to get user data',
        error: error.message
      });
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(req, res) {
    try {
      const { firebaseUid } = req.params;
      const updates = req.body;

      // Don't allow updating sensitive fields
      delete updates.firebaseUid;
      delete updates.email;
      delete updates.role;
      delete updates._id;

      const user = await User.findOneAndUpdate(
        { firebaseUid },
        { ...updates, updatedAt: new Date() },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      logger.info('User profile updated', {
        firebaseUid,
        updates: Object.keys(updates)
      });

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: user
      });
    } catch (error) {
      logger.error('Profile update failed', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        error: error.message
      });
    }
  }

  /**
   * Delete user account
   */
  static async deleteAccount(req, res) {
    try {
      const { firebaseUid } = req.params;

      // Delete from MongoDB
      const user = await User.findOneAndDelete({ firebaseUid });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Delete from Firebase Auth
      try {
        await admin.auth().deleteUser(firebaseUid);
        logger.info('User deleted from Firebase Auth', { firebaseUid });
      } catch (firebaseError) {
        logger.warn('Failed to delete from Firebase Auth', {
          firebaseUid,
          error: firebaseError.message
        });
      }

      logger.info('User account deleted', {
        firebaseUid,
        email: user.email
      });

      return res.status(200).json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error) {
      logger.error('Account deletion failed', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to delete account',
        error: error.message
      });
    }
  }

  /**
   * Verify email (called after Firebase email verification)
   */
  static async verifyEmail(req, res) {
    try {
      const { firebaseUid } = req.body;

      const user = await User.findOneAndUpdate(
        { firebaseUid },
        { emailVerified: true, updatedAt: new Date() },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      logger.info('Email verified', {
        firebaseUid,
        email: user.email
      });

      return res.status(200).json({
        success: true,
        message: 'Email verified successfully'
      });
    } catch (error) {
      logger.error('Email verification failed', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to verify email',
        error: error.message
      });
    }
  }
}

module.exports = FirebaseAuthController;

