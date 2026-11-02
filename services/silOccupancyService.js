const SILOccupancy = require('../models/SILOccupancy');
const SILProperty = require('../models/SILProperty');
const logger = require('../config/logger');

/**
 * SIL occupancy operations (Phase 4).
 * See docs/SIL_MANAGEMENT_SPEC.md sections 4 and 8 (validation rules).
 */
class SILOccupancyService {
  async listOccupancy(organizationId, { propertyId, clientId, status } = {}) {
    const filter = { organizationId };
    if (propertyId) filter.propertyId = propertyId;
    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;
    return SILOccupancy.find(filter).sort({ startDate: -1 });
  }

  /**
   * Create an occupancy. Enforces:
   *  - the property exists in the org
   *  - the room exists on the property
   *  - no other active occupancy exists for the room
   */
  async createOccupancy(organizationId, data, actor = '') {
    const property = await SILProperty.findOne({
      _id: data.propertyId,
      organizationId,
    });
    if (!property) {
      const err = new Error('Property not found.');
      err.statusCode = 404;
      throw err;
    }

    const room = (property.rooms || []).find((r) => r.roomId === data.roomId);
    if (!room) {
      const err = new Error('Room not found on this property.');
      err.statusCode = 400;
      throw err;
    }

    // Participants, like rooms, must belong to this organisation.
    const Client = require('../models/Client');
    const client = await Client.findOne({
      _id: data.clientId,
      organizationId,
    })
      .select('_id')
      .lean();
    if (!client) {
      const err = new Error('Client not found in this organization.');
      err.statusCode = 403;
      err.code = 'CROSS_ORG_CLIENT';
      throw err;
    }

    // §8.2: occupancy date ranges must not overlap for the same room, across
    // active AND pending rows (not just a single active row).
    const start = data.startDate ? new Date(data.startDate) : new Date();
    const end = data.endDate ? new Date(data.endDate) : null;
    const farFuture = new Date('9999-12-31T00:00:00.000Z');
    const conflict = await SILOccupancy.findOne({
      organizationId,
      propertyId: data.propertyId,
      roomId: data.roomId,
      status: { $in: ['active', 'pending'] },
      startDate: { $lt: end || farFuture },
      $or: [{ endDate: null }, { endDate: { $gt: start } }],
    });
    if (conflict) {
      const err = new Error('This room already has an occupancy overlapping those dates.');
      err.statusCode = 409;
      throw err;
    }

    const occupancy = await SILOccupancy.create({
      organizationId,
      propertyId: data.propertyId,
      roomId: data.roomId,
      clientId: data.clientId,
      startDate: start,
      endDate: end,
      status: data.status || 'active',
      fundingType: data.fundingType || 'plan_managed',
      createdBy: actor,
      updatedBy: actor,
    });

    logger.business('SIL Occupancy Created', {
      event: 'sil_occupancy_created',
      organizationId,
      occupancyId: occupancy._id.toString(),
      propertyId: String(data.propertyId),
    });

    return occupancy;
  }

  /**
   * End or relocate an occupancy. Passing a new roomId relocates the
   * participant (ends the current record and opens a new one).
   */
  async endOccupancy(organizationId, id, { endDate, vacatedReason, newRoomId } = {}, actor = '') {
    const occupancy = await SILOccupancy.findOne({ _id: id, organizationId });
    if (!occupancy) {
      const err = new Error('Occupancy not found.');
      err.statusCode = 404;
      throw err;
    }

    const effectiveEnd = endDate ? new Date(endDate) : new Date();

    if (newRoomId && newRoomId !== occupancy.roomId) {
      // Relocate: close current, open new.
      occupancy.status = 'ended';
      occupancy.endDate = effectiveEnd;
      occupancy.vacatedReason = vacatedReason || 'relocated';
      occupancy.updatedBy = actor;
      await occupancy.save();

      return this.createOccupancy(
        organizationId,
        {
          propertyId: occupancy.propertyId,
          roomId: newRoomId,
          clientId: occupancy.clientId,
          startDate: effectiveEnd,
          fundingType: occupancy.fundingType,
        },
        actor,
      );
    }

    occupancy.status = 'ended';
    occupancy.endDate = effectiveEnd;
    occupancy.vacatedReason = vacatedReason || '';
    occupancy.updatedBy = actor;
    await occupancy.save();
    return occupancy;
  }

  /**
   * Record a temporary absence (e.g. hospital admission, family leave, holiday) for an occupancy (Milestone 2.1).
   * Under NDIS guidelines, hospital stays are claimable up to 28 consecutive days before billing must pause.
   *
   * @param {string} organizationId
   * @param {string} id - Occupancy ID
   * @param {Object} data - { startDate, endDate?, reason?: 'hospital'|'family_leave'|'holiday'|'transition'|'other', notes?, maxClaimableDays? }
   * @param {string} actor
   * @returns {Promise<Object>} the created absence subdocument
   */
  async recordAbsence(organizationId, id, data, actor = '') {
    const occupancy = await SILOccupancy.findOne({ _id: id, organizationId });
    if (!occupancy) {
      const err = new Error('Occupancy not found.');
      err.statusCode = 404;
      throw err;
    }

    if (!data.startDate) {
      const err = new Error('Absence startDate is required.');
      err.statusCode = 400;
      throw err;
    }

    const startDate = new Date(data.startDate);
    const endDate = data.endDate ? new Date(data.endDate) : null;
    if (endDate && endDate < startDate) {
      const err = new Error('Absence endDate must be on or after startDate.');
      err.statusCode = 400;
      throw err;
    }

    const reason = data.reason || 'hospital';
    const maxClaimableDays =
      typeof data.maxClaimableDays === 'number'
        ? data.maxClaimableDays
        : 28; // Default 28 days under NDIS hospital leave rules

    const absence = {
      startDate,
      endDate,
      reason,
      notes: data.notes || '',
      maxClaimableDays,
      claimedDays: 0,
      createdBy: actor,
    };

    occupancy.absences.push(absence);
    occupancy.updatedBy = actor;
    await occupancy.save();

    const created = occupancy.absences[occupancy.absences.length - 1];

    logger.business('SIL Absence Recorded', {
      event: 'sil_absence_recorded',
      organizationId,
      occupancyId: occupancy._id.toString(),
      absenceId: created._id?.toString(),
      reason,
      startDate: startDate.toISOString(),
      maxClaimableDays,
    });

    return created;
  }

  /**
   * End an ongoing absence or update its return date (Milestone 2.1).
   *
   * @param {string} organizationId
   * @param {string} id - Occupancy ID
   * @param {string} absenceId - Absence subdocument ID
   * @param {Object} opts - { endDate }
   * @param {string} actor
   */
  async endAbsence(organizationId, id, absenceId, { endDate } = {}, actor = '') {
    const occupancy = await SILOccupancy.findOne({ _id: id, organizationId });
    if (!occupancy) {
      const err = new Error('Occupancy not found.');
      err.statusCode = 404;
      throw err;
    }

    const absence = (occupancy.absences || []).id(absenceId);
    if (!absence) {
      const err = new Error('Absence record not found.');
      err.statusCode = 404;
      throw err;
    }

    const effectiveEnd = endDate ? new Date(endDate) : new Date();
    if (effectiveEnd < absence.startDate) {
      const err = new Error('Absence endDate cannot be earlier than startDate.');
      err.statusCode = 400;
      throw err;
    }

    absence.endDate = effectiveEnd;
    occupancy.updatedBy = actor;
    await occupancy.save();

    logger.business('SIL Absence Ended', {
      event: 'sil_absence_ended',
      organizationId,
      occupancyId: occupancy._id.toString(),
      absenceId: absence._id?.toString(),
      endDate: effectiveEnd.toISOString(),
    });

    return absence;
  }

  /**
   * List all absences across an organisation or scoped to an occupancy, client, or property (Milestone 2.1).
   */
  async listAbsences(organizationId, { occupancyId, clientId, propertyId } = {}) {
    const filter = { organizationId };
    if (occupancyId) filter._id = occupancyId;
    if (clientId) filter.clientId = clientId;
    if (propertyId) filter.propertyId = propertyId;

    const occupancies = await SILOccupancy.find(filter).lean();
    const absences = [];

    for (const occ of occupancies) {
      for (const abs of occ.absences || []) {
        absences.push({
          ...abs,
          id: abs._id?.toString(),
          occupancyId: occ._id.toString(),
          clientId: occ.clientId?.toString(),
          propertyId: occ.propertyId?.toString(),
          roomId: occ.roomId,
        });
      }
    }

    return absences.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  }
}

module.exports = new SILOccupancyService();
