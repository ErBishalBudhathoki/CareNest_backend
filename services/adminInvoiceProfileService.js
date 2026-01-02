/**
 * Admin Invoice Profile Service
 * Provides CRUD operations for admin/business invoice profile used for invoice rendering
 */
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const logger = require('../config/logger');

class AdminInvoiceProfileService {
  /**
   * Initialize service with MongoDB connection params
   */
  constructor() {
    this.client = null;
    this.db = null;
    this.uri = process.env.MONGODB_URI;
  }

  /**
   * Connect to MongoDB and select database
   * @returns {Promise<void>}
   */
  async connect() {
    if (!this.client) {
      this.client = await MongoClient.connect(this.uri, {
        serverApi: ServerApiVersion.v1,
      });
      this.db = this.client.db('Invoice');
    }
  }

  /**
   * Close MongoDB connection
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  /**
   * Create a new admin invoice profile
   * @param {Object} profile - Profile payload
   * @returns {Promise<Object>} Created document
   */
  async createProfile(profile) {
    try {
      await this.connect();
      const now = new Date();
      const doc = {
        _id: new ObjectId(),
        organizationId: profile.organizationId,
        businessName: profile.businessName,
        businessAddress: profile.businessAddress,
        contactEmail: profile.contactEmail,
        contactPhone: profile.contactPhone,
        taxIdentifiers: profile.taxIdentifiers || {},
        bankDetails: profile.bankDetails || null, // optional embed or reference id
        isActive: profile.isActive !== false,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.collection('adminInvoiceProfiles').insertOne(doc);
      return { success: true, data: doc };
    } catch (error) {
      logger.error('AdminInvoiceProfileService.createProfile failed', {
        error: error.message,
        stack: error.stack,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active admin invoice profile by organizationId
   * @param {string} organizationId
   * @returns {Promise<Object>} Query result
   */
  async getActiveProfileByOrganization(organizationId) {
    try {
      await this.connect();
      const doc = await this.db.collection('adminInvoiceProfiles').findOne({
        organizationId,
        isActive: true,
      });
      if (!doc) {
        return { success: false, error: 'Admin invoice profile not found' };
      }
      return { success: true, data: doc };
    } catch (error) {
      logger.error('AdminInvoiceProfileService.getActiveProfileByOrganization failed', {
        error: error.message,
        stack: error.stack,
        organizationId,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing admin invoice profile
   * @param {string} profileId
   * @param {Object} updates
   * @returns {Promise<Object>} Update result
   */
  async updateProfile(profileId, updates) {
    try {
      await this.connect();
      const _id = new ObjectId(profileId);
      const payload = { ...updates, updatedAt: new Date() };
      const res = await this.db.collection('adminInvoiceProfiles').findOneAndUpdate(
        { _id },
        { $set: payload },
        { returnDocument: 'after' }
      );
      if (!res.value) {
        return { success: false, error: 'Profile not found' };
      }
      return { success: true, data: res.value };
    } catch (error) {
      logger.error('AdminInvoiceProfileService.updateProfile failed', {
        error: error.message,
        stack: error.stack,
        profileId,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Soft delete a profile
   * @param {string} profileId
   * @returns {Promise<Object>} Delete result
   */
  async deleteProfile(profileId) {
    try {
      await this.connect();
      const _id = new ObjectId(profileId);
      const res = await this.db.collection('adminInvoiceProfiles').updateOne(
        { _id },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
      return { success: true, data: { modifiedCount: res.modifiedCount } };
    } catch (error) {
      logger.error('AdminInvoiceProfileService.deleteProfile failed', {
        error: error.message,
        stack: error.stack,
        profileId,
      });
      return { success: false, error: error.message };
    }
  }
}

module.exports = { AdminInvoiceProfileService };
