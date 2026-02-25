const { admin } = require('../firebase-admin-config');
const { createLogger } = require('../utils/logger');
const User = require('../models/User');
const Organization = require('../models/Organization');
const UserOrganization = require('../models/UserOrganization');

const logger = createLogger('FirebaseAuthController');
const Client = require('../models/Client');

class FirebaseAuthController {
  static async _markClientActivationComplete(user, now = new Date()) {
    if (!user || user.role !== 'client') {
      return { matched: 0, modified: 0 };
    }

    const clientQuery = user.clientId
      ? { _id: user.clientId }
      : { clientEmail: String(user.email || '').trim().toLowerCase() };

    const updateResult = await Client.updateOne(
      clientQuery,
      {
        $set: {
          isActivated: true,
          activationPending: false,
          activatedAt: now,
          isActive: true,
          updatedAt: now
        },
        $unset: {
          deletedAt: '',
          deletedBy: '',
          purgeAfter: ''
        }
      }
    );

    const matched = Number.isInteger(updateResult?.matchedCount)
      ? updateResult.matchedCount
      : Number(updateResult?.n || 0);
    const modified = Number.isInteger(updateResult?.modifiedCount)
      ? updateResult.modifiedCount
      : Number(updateResult?.nModified || 0);

    return { matched, modified };
  }

  /**
   * Sync Firebase user with MongoDB after successful authentication
   * This endpoint is called after Firebase Auth succeeds on the client
   */
  static async syncUser(req, res) {
    try {
      const { firebaseUid, email, firstName, lastName, photoURL } = req.body;
      const emailVerifiedFromFirebase = Boolean(
        req.firebaseUser?.email_verified
      );

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
            emailVerified: emailVerifiedFromFirebase,
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
      user.emailVerified = emailVerifiedFromFirebase;
      user.lastLoginAt = new Date();
      user.updatedAt = new Date();

      await user.save();

      // Mark client activation complete after successful Firebase login sync.
      if (user.role === 'client') {
        await this._markClientActivationComplete(user, new Date());
      }

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
        clientId: user.clientId ? user.clientId.toString() : null,
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
   * Complete client activation immediately after successful password setup on web reset page.
   */
  static async completeClientActivation(req, res) {
    try {
      const tokenUid = req.firebaseUser?.uid;
      const tokenEmail = String(req.firebaseUser?.email || '')
        .trim()
        .toLowerCase();

      if (!tokenUid || !tokenEmail) {
        return res.status(400).json({
          success: false,
          message: 'Valid Firebase token is required'
        });
      }

      const user = req.user || (await User.findOne({ firebaseUid: tokenUid }));

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.role !== 'client') {
        return res.status(403).json({
          success: false,
          message: 'Only client accounts can complete this activation flow'
        });
      }

      const now = new Date();
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            firebaseUid: tokenUid,
            firebaseSyncedAt: now,
            isActive: true,
            updatedAt: now
          }
        }
      );

      const userDoc = user.toObject ? user.toObject() : user;
      const activation = await this._markClientActivationComplete(
        {
          ...userDoc,
          _id: user._id,
          role: user.role,
          clientId: user.clientId,
          email: tokenEmail || user.email
        },
        now
      );

      if (activation.matched === 0) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found for this account'
        });
      }

      logger.info('Client activation completed from web reset flow', {
        firebaseUid: tokenUid,
        email: tokenEmail,
        userId: user._id?.toString?.() || null,
        clientId: user.clientId?.toString?.() || null
      });

      return res.status(200).json({
        success: true,
        message: 'Client activation completed',
        data: {
          isActivated: true,
          activationPending: false,
          activatedAt: now.toISOString()
        }
      });
    } catch (error) {
      logger.error('Client activation completion failed', {
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to complete client activation',
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
      const tokenFirebaseUid = req.firebaseUser?.uid;
      const tokenEmail = req.firebaseUser?.email;
      const tokenEmailVerified = Boolean(req.firebaseUser?.email_verified);
      const bodyFirebaseUid = req.body?.firebaseUid;
      const firebaseUid = tokenFirebaseUid || bodyFirebaseUid;

      if (!firebaseUid) {
        return res.status(400).json({
          success: false,
          message: 'Firebase UID is required'
        });
      }

      if (
        tokenFirebaseUid &&
        bodyFirebaseUid &&
        tokenFirebaseUid !== bodyFirebaseUid
      ) {
        return res.status(403).json({
          success: false,
          message: 'Token user does not match requested user'
        });
      }

      if (!tokenEmailVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email is not verified in Firebase yet'
        });
      }

      let user = await User.findOneAndUpdate(
        { firebaseUid },
        { emailVerified: true, updatedAt: new Date() },
        { new: true }
      );

      // Fallback for older records that may be linked by email only.
      if (!user && tokenEmail) {
        user = await User.findOneAndUpdate(
          { email: tokenEmail.toLowerCase() },
          {
            firebaseUid,
            emailVerified: true,
            firebaseSyncedAt: new Date(),
            updatedAt: new Date()
          },
          { new: true }
        );
      }

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
        message: 'Email verified successfully',
        data: { emailVerified: true }
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
