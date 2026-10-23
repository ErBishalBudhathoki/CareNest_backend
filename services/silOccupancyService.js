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
}

module.exports = new SILOccupancyService();
