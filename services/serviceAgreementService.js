const ServiceAgreement = require('../models/ServiceAgreement');
const logger = require('../config/logger');

/**
 * ServiceAgreementService (Milestone 4.2)
 * Manages NDIS Service Agreements and evaluates consent gates before
 * activating SIL Rosters of Care or converting quotes.
 */
class ServiceAgreementService {
  /**
   * List service agreements for an organization.
   * @param {string} organizationId
   * @param {Object} filter - { clientId, status, agreementType }
   * @returns {Promise<Array>}
   */
  async list(organizationId, { clientId, status, agreementType } = {}) {
    const query = { organizationId };
    if (clientId) query.clientId = clientId;
    if (status) query.status = status;
    if (agreementType) query.agreementType = agreementType;
    return ServiceAgreement.find(query).sort({ effectiveFrom: -1 });
  }

  /**
   * Get a single service agreement by ID.
   * @param {string} organizationId
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async get(organizationId, id) {
    return ServiceAgreement.findOne({ _id: id, organizationId });
  }

  /**
   * Create a new service agreement.
   * @param {string} organizationId
   * @param {Object} data
   * @param {string} actor
   * @returns {Promise<Object>}
   */
  async create(organizationId, data, actor = '') {
    const agreementNumber =
      data.agreementNumber ||
      `SA-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const doc = await ServiceAgreement.create({
      organizationId,
      clientId: data.clientId,
      propertyId: data.propertyId || null,
      quoteId: data.quoteId || null,
      rosterOfCareId: data.rosterOfCareId || null,
      agreementNumber,
      agreementType: data.agreementType || 'sil',
      status: data.status || 'draft',
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      participantContribution: data.participantContribution || { boardAndLodgingWeekly: 0 },
      nomineeConsent: data.nomineeConsent || {},
      notes: data.notes || '',
      createdBy: actor,
      updatedBy: actor,
    });

    logger.business('Service Agreement Created', {
      event: 'service_agreement_created',
      organizationId,
      agreementId: doc._id.toString(),
      agreementNumber: doc.agreementNumber,
      clientId: String(doc.clientId),
    });

    return doc;
  }

  /**
   * Sign an agreement with participant or nominee signature.
   * Transitions status to 'signed' (or 'active' if effectiveFrom <= now).
   * @param {string} organizationId
   * @param {string} id
   * @param {Object} signatureData - { name, role, signatureData, ipAddress }
   * @param {string} actor
   * @returns {Promise<Object|null>}
   */
  async sign(organizationId, id, signatureData = {}, actor = '') {
    const agreement = await ServiceAgreement.findOne({ _id: id, organizationId });
    if (!agreement) return null;

    agreement.status = 'signed';
    agreement.signedAt = new Date();
    agreement.signedBy = {
      name: signatureData.name || actor,
      role: signatureData.role || 'participant',
      signatureData: signatureData.signatureData || '',
      ipAddress: signatureData.ipAddress || '',
    };
    agreement.updatedBy = actor;

    await agreement.save();

    logger.business('Service Agreement Signed', {
      event: 'service_agreement_signed',
      organizationId,
      agreementId: agreement._id.toString(),
      signedBy: agreement.signedBy.name,
    });

    return agreement;
  }

  /**
   * Check if a participant has an active signed service agreement.
   * Required before activating a SIL Roster of Care (M4.2 Consent Gate).
   * @param {string} organizationId
   * @param {string} clientId
   * @param {Date} [atDate=new Date()]
   * @returns {Promise<{ hasActiveAgreement: boolean, agreement: Object|null, reason?: string }>}
   */
  async checkActiveAgreement(organizationId, clientId, atDate = new Date()) {
    const targetDate = atDate ? new Date(atDate) : new Date();

    const agreement = await ServiceAgreement.findOne({
      organizationId,
      clientId,
      status: { $in: ['signed', 'active'] },
      effectiveFrom: { $lte: targetDate },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: targetDate } }],
    }).sort({ effectiveFrom: -1 });

    if (!agreement) {
      // Check if there is an expired or draft agreement to give specific diagnosis
      const anyAgreement = await ServiceAgreement.findOne({
        organizationId,
        clientId,
      }).sort({ createdAt: -1 });

      if (!anyAgreement) {
        return {
          hasActiveAgreement: false,
          agreement: null,
          reason: 'No Service Agreement exists for this participant.',
        };
      }

      if (anyAgreement.status === 'draft' || anyAgreement.status === 'pending_signature') {
        return {
          hasActiveAgreement: false,
          agreement: anyAgreement,
          reason: `Service Agreement (${anyAgreement.agreementNumber}) is in ${anyAgreement.status} status and has not been signed.`,
        };
      }

      if (anyAgreement.effectiveTo && anyAgreement.effectiveTo < targetDate) {
        return {
          hasActiveAgreement: false,
          agreement: anyAgreement,
          reason: `Service Agreement (${anyAgreement.agreementNumber}) expired on ${anyAgreement.effectiveTo.toISOString().slice(0, 10)}.`,
        };
      }

      return {
        hasActiveAgreement: false,
        agreement: anyAgreement,
        reason: `Service Agreement (${anyAgreement.agreementNumber}) is not active for the specified date.`,
      };
    }

    return {
      hasActiveAgreement: true,
      agreement,
    };
  }
}

module.exports = new ServiceAgreementService();
module.exports.ServiceAgreementService = ServiceAgreementService;

