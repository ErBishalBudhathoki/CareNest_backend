const GeofenceService = require('../services/geofenceService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class GeofenceController {
  /**
   * Create a new geofence location
   * POST /api/geofence/locations
   */
  createGeofence = catchAsync(async (req, res) => {
    const data = req.body;
    
    if (!data || !data.name || !data.latitude || !data.longitude || !data.radius) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: name, latitude, longitude, radius'
      });
    }
    
    const geofence = await GeofenceService.createGeofence(data);

    logger.business('Geofence created', {
      action: 'geofence_create',
      geofenceId: geofence?._id,
      name: data.name
    });

    return res.status(201).json({
      success: true,
      code: 'GEOFENCE_CREATED',
      data: geofence,
      message: 'Geofence location created successfully'
    });
  });

  /**
   * Get all geofence locations
   * GET /api/geofence/locations
   */
  getGeofences = catchAsync(async (req, res) => {
    const { clientId } = req.query;
    const geofences = await GeofenceService.getGeofences({ clientId });

    logger.business('Retrieved geofences', {
      action: 'geofence_list',
      clientId,
      count: geofences?.length || 0
    });

    return res.status(200).json({
      success: true,
      code: 'GEOFENCES_RETRIEVED',
      data: geofences
    });
  });

  /**
   * Update a geofence location
   * PUT /api/geofence/locations/:id
   */
  updateGeofence = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Geofence ID is required'
      });
    }

    const geofence = await GeofenceService.updateGeofence(id, updates);

    logger.business('Geofence updated', {
      action: 'geofence_update',
      geofenceId: id
    });

    return res.status(200).json({
      success: true,
      code: 'GEOFENCE_UPDATED',
      data: geofence,
      message: 'Geofence location updated successfully'
    });
  });

  /**
   * Delete a geofence location
   * DELETE /api/geofence/locations/:id
   */
  deleteGeofence = catchAsync(async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Geofence ID is required'
      });
    }

    await GeofenceService.deleteGeofence(id);

    logger.business('Geofence deleted', {
      action: 'geofence_delete',
      geofenceId: id
    });

    return res.status(200).json({
      success: true,
      code: 'GEOFENCE_DELETED',
      message: 'Geofence location deleted successfully'
    });
  });
}

module.exports = new GeofenceController();
