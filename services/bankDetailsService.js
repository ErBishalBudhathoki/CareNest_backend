const { MongoClient, ServerApiVersion } = require('mongodb');

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

  /**
   * Save or update bank details for a user in an organization.
   * @param {string} userEmail - User's email
   * @param {string} organizationId - Organization identifier
   * @param {{bankName:string, accountName:string, bsb:string, accountNumber:string}} details - Bank details payload
   * @returns {Promise<Object>} Saved bank details document (without _id)
   */
  async saveBankDetails(userEmail, organizationId, details) {
    let client;
    try {
      client = await this.getConnection();
      const db = client.db('Invoice');

      // Verify user belongs to organization and is active
      const user = await db.collection('login').findOne({
        email: userEmail,
        organizationId: organizationId,
        isActive: true,
      });

      if (!user) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const now = new Date();
      const filter = { userEmail, organizationId };
      const update = {
        $set: {
          userEmail,
          organizationId,
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
  async getBankDetails(userEmail, organizationId) {
    let client;
    try {
      client = await this.getConnection();
      const db = client.db('Invoice');
      const details = await db.collection('bankDetails').findOne(
        { userEmail, organizationId },
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