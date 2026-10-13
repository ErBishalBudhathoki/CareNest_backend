const SILProperty = require('../models/SILProperty');
const SILOccupancy = require('../models/SILOccupancy');
const logger = require('../config/logger');

/**
 * SIL property operations (Phase 4). See docs/SIL_MANAGEMENT_SPEC.md section 4.
 */
class SILPropertyService {
  async listProperties(organizationId, { active, state } = {}) {
    const filter = { organizationId };
    if (active !== undefined) filter.active = active;
    if (state) filter['address.state'] = state;
    return SILProperty.find(filter).sort({ name: 1 });
  }

  async getProperty(organizationId, id) {
    return SILProperty.findOne({ _id: id, organizationId });
  }

  async createProperty(organizationId, data, actor = '') {
    const rooms = this._normalizeRooms(data.rooms);
    const property = await SILProperty.create({
      organizationId,
      name: data.name,
      reference: data.reference || '',
      address: data.address || {},
      location: data.location || undefined,
      propertyType: data.propertyType || 'house',
      silDesignCategory: data.silDesignCategory || 'basic',
      rooms,
      bedrooms: data.bedrooms != null ? Number(data.bedrooms) : rooms.length,
      amenities: data.amenities || [],
      maxOccupancy: data.maxOccupancy != null ? Number(data.maxOccupancy) : rooms.length,
      active: data.active !== false,
      createdBy: actor,
      updatedBy: actor,
    });
    logger.business('SIL Property Created', {
      event: 'sil_property_created',
      organizationId,
      propertyId: property._id.toString(),
    });
    return property;
  }

  async updateProperty(organizationId, id, data, actor = '') {
    const update = { updatedBy: actor };
    const fields = [
      'name',
      'reference',
      'address',
      'propertyType',
      'silDesignCategory',
      'amenities',
    ];
    for (const f of fields) {
      if (data[f] !== undefined) update[f] = data[f];
    }
    if (data.rooms !== undefined) update.rooms = this._normalizeRooms(data.rooms);
    if (data.bedrooms !== undefined) update.bedrooms = Number(data.bedrooms);
    if (data.maxOccupancy !== undefined) update.maxOccupancy = Number(data.maxOccupancy);
    if (data.active !== undefined) update.active = data.active;

    return SILProperty.findOneAndUpdate({ _id: id, organizationId }, update, {
      new: true,
      runValidators: true,
    });
  }

  async deactivateProperty(organizationId, id, actor = '') {
    return SILProperty.findOneAndUpdate(
      { _id: id, organizationId },
      { active: false, updatedBy: actor },
      { new: true },
    );
  }

  /**
   * Compute the vacancy board for a property: rooms minus active occupancy.
   */
  async getVacancies(organizationId, propertyId) {
    const property = await SILProperty.findOne({ _id: propertyId, organizationId });
    if (!property) return null;

    const activeOccupancies = await SILOccupancy.find({
      organizationId,
      propertyId,
      status: 'active',
    });

    const occupiedRoomIds = new Set(activeOccupancies.map((o) => o.roomId));
    const rooms = (property.rooms || []).map((room) => ({
      roomId: room.roomId,
      label: room.label,
      accessibility: room.accessibility || [],
      occupied: occupiedRoomIds.has(room.roomId),
      occupancy: activeOccupancies.find((o) => o.roomId === room.roomId) || null,
    }));

    const totalRooms = rooms.length;
    const occupiedCount = rooms.filter((r) => r.occupied).length;

    return {
      propertyId: property._id.toString(),
      propertyName: property.name,
      totalRooms,
      occupiedCount,
      vacantCount: totalRooms - occupiedCount,
      rooms,
    };
  }

  _normalizeRooms(rooms) {
    if (!Array.isArray(rooms)) return [];
    return rooms
      .filter((r) => r && (r.roomId || r.label))
      .map((r, index) => ({
        roomId: String(r.roomId || `room-${index + 1}`),
        label: r.label ? String(r.label) : '',
        vacant: r.vacant !== false,
        accessibility: Array.isArray(r.accessibility) ? r.accessibility.map(String) : [],
      }));
  }
}

module.exports = new SILPropertyService();
