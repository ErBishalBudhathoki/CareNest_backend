const SILRosterOfCare = require('../models/SILRosterOfCare');
const logger = require('../config/logger');
const serviceAgreementService = require('./serviceAgreementService');

/**
 * Roster-of-care lifecycle (Phase 4).
 * See docs/SIL_MANAGEMENT_SPEC.md section 3.6.
 */
class SILRosterOfCareService {
  async list(organizationId, { clientId, status } = {}) {
    const filter = { organizationId };
    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;
    return SILRosterOfCare.find(filter).sort({ effectiveFrom: -1 });
  }

  async get(organizationId, id) {
    return SILRosterOfCare.findOne({ _id: id, organizationId });
  }

  async update(organizationId, id, data, actor = '') {
    const roc = await SILRosterOfCare.findOne({ _id: id, organizationId });
    if (!roc) return null;

    // Milestone 4.2 Consent Gate:
    // Require an active signed Service Agreement before transitioning an RoC from 'draft' (or any non-active status) to 'active'.
    // If no signed agreement exists and bypassConsent is not explicitly true, block the transition.
    if (data.status === 'active' && roc.status !== 'active') {
      if (!data.bypassConsent) {
        const agreementCheck = await serviceAgreementService.checkActiveAgreement(
          organizationId,
          roc.clientId,
          roc.effectiveFrom || new Date(),
        );

        if (!agreementCheck.hasActiveAgreement) {
          logger.warn('SIL RoC activation blocked by Consent Gate: Missing signed Service Agreement', {
            organizationId,
            rosterOfCareId: String(roc._id),
            clientId: String(roc.clientId),
            reason: agreementCheck.reason,
          });

          return {
            consentRequired: true,
            code: 'SERVICE_AGREEMENT_REQUIRED',
            message:
              agreementCheck.reason ||
              'A signed Service Agreement is required before activating a SIL Roster of Care.',
            agreement: agreementCheck.agreement || null,
          };
        }
      } else {
        // Milestone 4.2: Auditable Emergency Consent Bypass
        roc.history.push({
          changedAt: new Date(),
          changedBy: actor,
          change: `Consent Gate bypassed: ${data.bypassReason || 'Administrative emergency override'}`,
        });
        logger.business('SIL RoC Consent Gate Bypassed', {
          event: 'sil_roc_consent_bypassed',
          organizationId,
          rosterOfCareId: String(roc._id),
          bypassedBy: actor,
          reason: data.bypassReason || 'Administrative emergency override',
        });
      }
    }

    if (data.supports !== undefined) roc.supports = data.supports;
    if (data.effectiveTo !== undefined) roc.effectiveTo = data.effectiveTo;
    if (data.reviewSchedule !== undefined) roc.reviewSchedule = data.reviewSchedule;
    if (data.status !== undefined) roc.status = data.status;

    roc.history.push({
      changedAt: new Date(),
      changedBy: actor,
      change: data.changeNote || 'Updated roster of care',
    });
    roc.updatedBy = actor;
    await roc.save();
    return roc;
  }

  /** Record a scheduled review and advance the next-review date. */
  async review(organizationId, id, { cadence } = {}, actor = '') {
    const roc = await SILRosterOfCare.findOne({ _id: id, organizationId });
    if (!roc) return null;

    const nextCadence = cadence || roc.reviewSchedule?.cadence || 'quarterly';
    const from = new Date();
    const next = new Date(from);
    if (nextCadence === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (nextCadence === 'annual') next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 3);

    roc.reviewSchedule = { cadence: nextCadence, nextReviewDate: next };
    roc.status = 'active';
    roc.history.push({
      changedAt: new Date(),
      changedBy: actor,
      change: `Review completed; next review ${next.toISOString().slice(0, 10)}`,
    });
    roc.updatedBy = actor;
    await roc.save();

    logger.business('SIL RoC Reviewed', {
      event: 'sil_roc_reviewed',
      organizationId,
      rosterOfCareId: roc._id.toString(),
    });

    return roc;
  }

  async end(organizationId, id, actor = '') {
    const roc = await SILRosterOfCare.findOneAndUpdate(
      { _id: id, organizationId },
      {
        status: 'ended',
        effectiveTo: new Date(),
        updatedBy: actor,
        $push: {
          history: { changedAt: new Date(), changedBy: actor, change: 'Ended' },
        },
      },
      { new: true },
    );
    return roc;
  }
}

module.exports = new SILRosterOfCareService();
