const express = require('express');
const router = express.Router();
const GeofenceController = require('../controllers/geofenceController');
const { authenticateUser } = require('../middleware/auth');

// Apply authentication middleware to all routes
router.use(authenticateUser);

router.post('/locations', GeofenceController.createGeofence);
router.get('/locations', GeofenceController.getGeofences);
router.put('/locations/:id', GeofenceController.updateGeofence);
router.delete('/locations/:id', GeofenceController.deleteGeofence);

module.exports = router;
