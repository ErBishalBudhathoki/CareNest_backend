const GeofenceLocation = require('../models/GeofenceLocation');

class GeofenceService {
  /**
   * Create a new geofence location
   * @param {Object} data - Geofence data
   * @returns {Promise<Object>} Created geofence
   */
  async createGeofence(data) {
    const geofence = await GeofenceLocation.create(data);
    return geofence;
  }

  /**
   * Get all geofence locations (optionally filtered by clientId)
   * @param {Object} query - Filter query
   * @returns {Promise<Array>} List of geofences
   */
  async getGeofences(query = {}) {
    const filter = { isActive: true };
    
    if (query.clientId) {
      filter.clientId = query.clientId;
    }

    return await GeofenceLocation.find(filter)
      .sort({ name: 1 })
      .lean();
  }

  /**
   * Get a single geofence by ID
   * @param {string} id - Geofence ID
   * @returns {Promise<Object>} Geofence
   */
  async getGeofenceById(id) {
    return await GeofenceLocation.findById(id).lean();
  }

  /**
   * Update a geofence location
   * @param {string} id - Geofence ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated geofence
   */
  async updateGeofence(id, updates) {
    const geofence = await GeofenceLocation.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!geofence) {
      throw new Error('Geofence not found');
    }

    return geofence;
  }

  /**
   * Soft delete a geofence location
   * @param {string} id - Geofence ID
   * @returns {Promise<Object>} Deleted geofence
   */
  async deleteGeofence(id) {
    const geofence = await GeofenceLocation.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!geofence) {
      throw new Error('Geofence not found');
    }

    return geofence;
  }
}

module.exports = new GeofenceService();
