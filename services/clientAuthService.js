const Client = require('../models/Client');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const auditService = require('./auditService');
const emailService = require('./emailService');
const { admin } = require('../firebase-admin-config');

class ClientAuthService {
  _normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  _buildActivationEmailHtml({ firstName, resetLink }) {
    const safeFirstName = firstName || 'there';
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px; text-align: left;">
        <h2 style="color: #4CAF50;">Welcome to CareNest</h2>
        <p>Hi ${safeFirstName},</p>
        <p>Your client account has been activated. Set your password to start using the app.</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}" style="display: inline-block; padding: 12px 18px; background: #4CAF50; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Set Password
          </a>
        </p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #555;">${resetLink}</p>
        <p style="color: #777; font-size: 12px;">If you did not expect this email, you can ignore it.</p>
      </div>
    `;
  }

  /**
   * Activate client account by Admin
   * @param {string} email - Client email
   * @returns {Object} - Activation result
   */
  async activateClientByAdmin(email) {
    try {
      const normalizedEmail = this._normalizeEmail(email);
      if (!normalizedEmail) {
        throw new Error('Client email is required');
      }

      // 1. Verify client exists
      const client = await Client.findOne({
        clientEmail: normalizedEmail,
        isActive: true
      });
      if (!client) {
        throw new Error('Client email not found in records');
      }

      const now = new Date();
      const wasAlreadyActivated = client.isActivated === true;

      // 2. Ensure Firebase user exists
      let firebaseUser;
      try {
        firebaseUser = await admin.auth().getUserByEmail(normalizedEmail);
      } catch (firebaseLookupError) {
        if (firebaseLookupError.code !== 'auth/user-not-found') {
          throw firebaseLookupError;
        }

        // Create Firebase user with temporary random password.
        // Client sets their own password using the activation reset link.
        const temporaryPassword = `Temp#${Math.random().toString(36).slice(-12)}A1`;
        firebaseUser = await admin.auth().createUser({
          email: normalizedEmail,
          password: temporaryPassword,
          displayName: `${client.clientFirstName} ${client.clientLastName}`,
          emailVerified: false
        });
      }

      // 3. Upsert Mongo user as Firebase-linked client account
      let mongoUser = await User.findOne({ email: normalizedEmail });
      if (mongoUser && mongoUser.role && mongoUser.role !== 'client') {
        throw new Error('Email is already in use by a non-client account');
      }

      const userUpdate = {
        email: normalizedEmail,
        firstName: client.clientFirstName,
        lastName: client.clientLastName,
        organizationId: client.organizationId,
        role: 'client',
        clientId: client._id,
        isActive: true,
        firebaseUid: firebaseUser.uid,
        firebaseSyncedAt: now,
        emailVerified: Boolean(firebaseUser.emailVerified),
        updatedAt: now
      };

      if (mongoUser) {
        await User.updateOne(
          { _id: mongoUser._id },
          {
            $set: userUpdate,
            // Remove any stale local-password auth remnants.
            $unset: { password: '' }
          }
        );
        mongoUser = await User.findById(mongoUser._id);
      } else {
        mongoUser = await User.create({
          ...userUpdate,
          createdAt: now
        });
      }

      if (!mongoUser) {
        throw new Error('Failed to upsert client user');
      }

      // 4. Ensure UserOrganization record exists and is active
      if (client.organizationId) {
        await UserOrganization.updateOne(
          {
            userId: mongoUser._id.toString(),
            organizationId: client.organizationId.toString()
          },
          {
            $set: {
              role: 'client',
              permissions: ['read'],
              isActive: true,
              updatedAt: now
            },
            $setOnInsert: {
              joinedAt: now,
              createdAt: now
            }
          },
          { upsert: true }
        );
      }

      // 5. Mark client as activated
      await Client.updateOne(
        { _id: client._id },
        { $set: { isActivated: true, updatedAt: now } }
      );

      // 6. Generate Firebase reset link for password setup
      const activationContinueUrl =
        process.env.CLIENT_ACTIVATION_CONTINUE_URL ||
        process.env.PASSWORD_RESET_CONTINUE_URL ||
        process.env.FRONTEND_URL ||
        'https://careservices.page.link/reset-password';

      const resetLink = await admin.auth().generatePasswordResetLink(
        normalizedEmail,
        {
          url: activationContinueUrl,
          handleCodeInApp: true
        }
      );

      // 7. Send activation email
      const emailSubject = 'Set up your CareNest client account';
      const emailHtml = this._buildActivationEmailHtml({
        firstName: client.clientFirstName,
        resetLink
      });
      const emailResult = await emailService.sendEmail(
        normalizedEmail,
        emailSubject,
        emailHtml
      );

      // 8. Log audit trail
      await auditService.createAuditLog({
        action: 'UPDATE',
        entityType: 'user',
        entityId: mongoUser._id.toString(),
        userEmail: normalizedEmail,
        organizationId: client.organizationId,
        newValues: {
          clientId: client._id.toString(),
          role: 'client',
          firebaseUid: firebaseUser.uid
        },
        metadata: {
          resetLinkSent: Boolean(emailResult),
          alreadyActivated: wasAlreadyActivated
        }
      });

      return {
        userId: mongoUser._id.toString(),
        clientId: client._id.toString(),
        email: normalizedEmail,
        firebaseUid: firebaseUser.uid,
        emailSent: Boolean(emailResult),
        alreadyActivated: wasAlreadyActivated
      };
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

      const client = await Client.findById(user.clientId);

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
