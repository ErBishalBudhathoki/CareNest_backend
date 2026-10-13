const SILRosterOfCare = require('../models/SILRosterOfCare');
const logger = require('../config/logger');

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
