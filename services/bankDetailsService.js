const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

/**
 * BankDetailsService
 * Handles business logic for saving and retrieving bank details.
 * Uses the 'Invoice' database consistently to avoid casing issues.
 */
class BankDetailsService {
  constructor() {
    this.uri = process.env.MONGODB_URI;
  }

  async getConnection() {
    const client = new MongoClient(this.uri, { tls: true, family: 4,  serverApi: ServerApiVersion.v1 });
    await client.connect();
    return client;
  }

  _normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  _normalizeOrganizationId(organizationId) {
    return String(organizationId || '').trim();
  }

  _buildOrgMembershipQuery(organizationId) {
    const normalizedOrgId = this._normalizeOrganizationId(organizationId);
    const orgCandidates = [normalizedOrgId];
    if (ObjectId.isValid(normalizedOrgId)) {
      orgCandidates.push(new ObjectId(normalizedOrgId));
    }
    return { $in: orgCandidates };
  }

  async _findActiveUserByEmail(db, email) {
    return db.collection('users').findOne({
      email: this._normalizeEmail(email),
      isActive: { $ne: false },
    });
  }

  async _findActiveMembership(db, userId, organizationId) {
    return db.collection('userorganizations').findOne({
      userId,
      organizationId: this._buildOrgMembershipQuery(organizationId),
      isActive: true,
    });
  }

  async _assertAccess(db, actorEmail, targetEmail, organizationId) {
    const normalizedActorEmail = this._normalizeEmail(actorEmail);
    const normalizedTargetEmail = this._normalizeEmail(targetEmail);
    const normalizedOrganizationId = this._normalizeOrganizationId(organizationId);

    if (!normalizedActorEmail) {
      const err = new Error('Authentication required');
      err.code = 'AUTH_REQUIRED';
      err.status = 401;
      throw err;
    }

    if (!normalizedTargetEmail) {
      const err = new Error('Target user email is required');
      err.code = 'TARGET_USER_REQUIRED';
      err.status = 400;
      throw err;
    }

    if (!normalizedOrganizationId) {
      const err = new Error('Organization ID is required');
      err.code = 'ORG_ID_REQUIRED';
      err.status = 400;
      throw err;
    }

    const actorUser = await this._findActiveUserByEmail(db, normalizedActorEmail);
    if (!actorUser) {
      const err = new Error('Authenticated user not found');
      err.code = 'ACTOR_NOT_FOUND';
      err.status = 401;
      throw err;
    }

    const actorMembership = await this._findActiveMembership(db, actorUser._id, normalizedOrganizationId);
    if (!actorMembership) {
      const err = new Error('Access denied to organization');
      err.code = 'ORG_ACCESS_DENIED';
      err.status = 403;
      throw err;
    }

    if (normalizedTargetEmail !== normalizedActorEmail) {
      const role = String(actorMembership.role || '').toLowerCase();
      if (!['admin', 'owner'].includes(role)) {
        const err = new Error('Admin access required');
        err.code = 'ADMIN_REQUIRED';
        err.status = 403;
        throw err;
      }
    }

    const targetUser = await this._findActiveUserByEmail(db, normalizedTargetEmail);
    if (!targetUser) {
      const err = new Error('Target user not found');
      err.code = 'TARGET_USER_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const targetMembership = await this._findActiveMembership(db, targetUser._id, normalizedOrganizationId);
    if (!targetMembership) {
      const err = new Error('Target user not found in organization');
      err.code = 'TARGET_ORG_ACCESS_DENIED';
      err.status = 404;
      throw err;
    }

    return {
      actorMembership,
      targetEmail: normalizedTargetEmail,
      organizationId: normalizedOrganizationId,
    };
  }

  /**
   * Save or update bank details for a user in an organization.
   * @param {string} userEmail - User's email
   * @param {string} organizationId - Organization identifier
   * @param {{bankName:string, accountName:string, bsb:string, accountNumber:string}} details - Bank details payload
   * @returns {Promise<Object>} Saved bank details document (without _id)
   */
  async saveBankDetails(actorEmail, targetEmail, organizationId, details) {
    let client;
    try {
      client = await this.getConnection();
      const db = client.db('Invoice');
      const access = await this._assertAccess(
        db,
        actorEmail,
        targetEmail,
        organizationId
      );

      const now = new Date();
      const filter = {
        userEmail: access.targetEmail,
        organizationId: access.organizationId,
      };
      const update = {
        $set: {
          userEmail: access.targetEmail,
          organizationId: access.organizationId,
          bankName: details.bankName,
          accountName: details.accountName,
          bsb: details.bsb,
          accountNumber: details.accountNumber,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      };

      await db.collection('bankDetails').updateOne(filter, update, { upsert: true });
      const saved = await db.collection('bankDetails').findOne(filter, { projection: { _id: 0 } });
      return saved;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  /**
   * Retrieve bank details for a user in an organization.
   * @param {string} userEmail - User's email
   * @param {string} organizationId - Organization identifier
   * @returns {Promise<Object|null>} Bank details document or null
   */
  async getBankDetails(actorEmail, targetEmail, organizationId) {
    let client;
    try {
      client = await this.getConnection();
      const db = client.db('Invoice');
      const access = await this._assertAccess(
        db,
        actorEmail,
        targetEmail,
        organizationId
      );
      const details = await db.collection('bankDetails').findOne(
        {
          userEmail: access.targetEmail,
          organizationId: access.organizationId,
        },
        { projection: { _id: 0 } }
      );
      return details;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }
}

module.exports = new BankDetailsService();
