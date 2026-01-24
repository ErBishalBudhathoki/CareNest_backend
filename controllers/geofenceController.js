const GeofenceService = require('../services/geofenceService');
const logger = require('../utils/logger').createLogger('GeofenceController');

class GeofenceController {
  /**
   * Create a new geofence location
   * POST /api/geofence/locations
   */
  async createGeofence(req, res) {
    try {
      const data = req.body;
      const geofence = await GeofenceService.createGeofence(data);

      return res.status(201).json({
        success: true,
        data: geofence,
        message: 'Geofence location created successfully'
      });
    } catch (error) {
      logger.error('Error creating geofence', { error: error.message });
      return res.status(500).json({
        success: false,
        message: 'Failed to create geofence location'
      });
    }
  }

  /**
   * Get all geofence locations
   * GET /api/geofence/locations
   */
  async getGeofences(req, res) {
    try {
      const { clientId } = req.query;
      const geofences = await GeofenceService.getGeofences({ clientId });

      return res.status(200).json({
        success: true,
        data: geofences
      });
    } catch (error) {
      logger.error('Error fetching geofences', { error: error.message });
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch geofence locations'
      });
    }
  }

  /**
   * Update a geofence location
   * PUT /api/geofence/locations/:id
   */
  async updateGeofence(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const geofence = await GeofenceService.updateGeofence(id, updates);

      return res.status(200).json({
        success: true,
        data: geofence,
        message: 'Geofence location updated successfully'
      });
    } catch (error) {
      logger.error('Error updating geofence', { error: error.message, id: req.params.id });
      
      if (error.message === 'Geofence not found') {
        return res.status(404).json({
          success: false,
          message: 'Geofence location not found'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to update geofence location'
      });
    }
  }

  /**
   * Delete a geofence location
   * DELETE /api/geofence/locations/:id
   */
  async deleteGeofence(req, res) {
    try {
      const { id } = req.params;

      await GeofenceService.deleteGeofence(id);

      return res.status(200).json({
        success: true,
        message: 'Geofence location deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting geofence', { error: error.message, id: req.params.id });
      
      if (error.message === 'Geofence not found') {
        return res.status(404).json({
          success: false,
          message: 'Geofence location not found'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to delete geofence location'
      });
    }
  }
}

module.exports = new GeofenceController();
