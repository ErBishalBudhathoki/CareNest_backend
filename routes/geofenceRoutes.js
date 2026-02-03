const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const GeofenceController = require('../controllers/geofenceController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const geofenceLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many geofence requests.' }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const createGeofenceValidation = [
    body('name').trim().notEmpty().withMessage('Geofence name is required'),
    body('name').isLength({ max: 100 }).withMessage('Name too long (max 100 characters)'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
    body('radius').isFloat({ min: 10, max: 5000 }).withMessage('Radius must be between 10 and 5000 meters'),
    body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
    body('description').optional().trim().isLength({ max: 500 }),
    body('isActive').optional().isBoolean()
];

const updateGeofenceValidation = [
    param('id').isMongoId().withMessage('Valid geofence ID is required'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('name').optional().isLength({ max: 100 }),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('radius').optional().isFloat({ min: 10, max: 5000 }),
    body('isActive').optional().isBoolean()
];

const geofenceIdValidation = [
    param('id').isMongoId().withMessage('Valid geofence ID is required')
];

// Apply authentication middleware to all routes
router.use(authenticateUser);

router.post('/locations', strictLimiter, createGeofenceValidation, handleValidationErrors, GeofenceController.createGeofence);
router.get('/locations', geofenceLimiter, GeofenceController.getGeofences);
router.put('/locations/:id', strictLimiter, updateGeofenceValidation, handleValidationErrors, GeofenceController.updateGeofence);
router.delete('/locations/:id', strictLimiter, geofenceIdValidation, handleValidationErrors, GeofenceController.deleteGeofence);

module.exports = router;
