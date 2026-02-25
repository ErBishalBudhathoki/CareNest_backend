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

  _buildActivatableClientQuery(normalizedEmail) {
    return {
      clientEmail: normalizedEmail
    };
  }

  _extractResetOobCode(resetLink) {
    try {
      const parsed = new URL(resetLink);
      const mode = parsed.searchParams.get('mode');
      const code = parsed.searchParams.get('oobCode');
      if (mode === 'resetPassword' && code) {
        return code;
      }

      const nestedLink = parsed.searchParams.get('link');
      if (nestedLink) {
        const nested = new URL(nestedLink);
        const nestedMode = nested.searchParams.get('mode');
        const nestedCode = nested.searchParams.get('oobCode');
        if (nestedMode === 'resetPassword' && nestedCode) {
          return nestedCode;
        }
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  _buildAppResetLink(oobCode) {
    if (!oobCode) return null;
    const query = new URLSearchParams({
      mode: 'resetPassword',
      oobCode: String(oobCode).trim()
    }).toString();
    return `com.bishal.invoice://reset-password?${query}`;
  }

  _buildActivationEmailHtml({ firstName, resetLink, appResetLink }) {
    const safeFirstName = firstName || 'there';
    const primaryLink = appResetLink || resetLink;
    const primaryLabel = appResetLink
      ? 'Set Password in CareNest App'
      : 'Set Password';
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px; text-align: left;">
        <h2 style="color: #4CAF50;">Welcome to CareNest</h2>
        <p>Hi ${safeFirstName},</p>
        <p>Your client account has been activated. Set your password to start using the app.</p>
        <p style="margin: 24px 0;">
          <a href="${primaryLink}" style="display: inline-block; padding: 12px 18px; background: #4CAF50; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
            ${primaryLabel}
          </a>
        </p>
        <p style="margin: 8px 0 16px;">
          <a href="${resetLink}" style="display: inline-block; padding: 10px 16px; background: #1A3BA0; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Open Web Reset Page
          </a>
        </p>
        <p>If the app button does not open the app, use this web link:</p>
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
      const client = await Client.findOne(
        this._buildActivatableClientQuery(normalizedEmail)
      );
      if (!client) {
        throw new Error('Client email not found in records');
      }

      const now = new Date();
      const wasAlreadyActivated = client.isActivated === true;

      // 2. Ensure Firebase user exists
      let firebaseUser;
      try {
        firebaseUser = await admin.auth().getUserByEmail(normalizedEmail);
        if (firebaseUser.disabled) {
          firebaseUser = await admin.auth().updateUser(firebaseUser.uid, {
            disabled: false
          });
        }
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
        {
          $set: { isActivated: true, isActive: true, updatedAt: now },
          $unset: { deletedAt: '', deletedBy: '', purgeAfter: '' }
        }
      );

      // 6. Generate Firebase reset link and deterministic in-app deep link
      const resetLink = await admin.auth().generatePasswordResetLink(
        normalizedEmail
      );
      const oobCode = this._extractResetOobCode(resetLink);
      const appResetLink = this._buildAppResetLink(oobCode);

      // 7. Send activation email
      const emailSubject = 'Set up your CareNest client account';
      const emailHtml = this._buildActivationEmailHtml({
        firstName: client.clientFirstName,
        resetLink,
        appResetLink
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
          alreadyActivated: wasAlreadyActivated,
          appResetLinkGenerated: Boolean(appResetLink)
        }
      });

      return {
        userId: mongoUser._id.toString(),
        clientId: client._id.toString(),
        email: normalizedEmail,
        firebaseUid: firebaseUser.uid,
        emailSent: Boolean(emailResult),
        alreadyActivated: wasAlreadyActivated,
        activationLinkFormat: appResetLink
          ? 'com.bishal.invoice://reset-password?mode=resetPassword&oobCode=...'
          : 'firebase-web-link'
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
