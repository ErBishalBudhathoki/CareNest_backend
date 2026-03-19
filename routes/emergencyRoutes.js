const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const EmergencyController = require('../controllers/emergencyController');
const { authenticateUser, requireRoles } = require('../middleware/auth');

// Rate limiting
const emergencyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many emergency requests. Please wait before broadcasting again.' }
});

const acknowledgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many acknowledge requests.' }
});

// Validation rules
const broadcastValidation = [
  body('organizationId').optional().isMongoId().withMessage('Valid organization ID is required'),
  body('message').trim().notEmpty().withMessage('Emergency message is required'),
  body('message').isLength({ max: 1000 }).withMessage('Message too long (max 1000 characters)'),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Severity must be low, medium, high, or critical'),
  body('targetGroups').optional().isArray().withMessage('Target groups must be an array'),
  body('location').optional().trim().isLength({ max: 255 }),
  body('requiresAcknowledgment').optional().isBoolean()
];

const acknowledgeValidation = [
  param('broadcastId').isMongoId().withMessage('Valid broadcast ID is required'),
  body('notes').optional().trim().isLength({ max: 500 })
];

// Protected routes
router.use(authenticateUser);

// GET /api/emergency/active — active broadcasts for the current user's teams
router.get('/active', emergencyLimiter, EmergencyController.getActive);

// POST /api/emergency/broadcast — send an emergency broadcast (admin/manager only)
router.post('/broadcast', requireRoles(['admin', 'manager']), emergencyLimiter, broadcastValidation, handleValidationErrors, EmergencyController.broadcast);

// PUT /api/emergency/broadcast/:broadcastId/acknowledge — acknowledge (existing route, used by EmergencyService)
router.put('/broadcast/:broadcastId/acknowledge', acknowledgeLimiter, acknowledgeValidation, handleValidationErrors, EmergencyController.acknowledge);

// POST /api/emergency/acknowledge/:broadcastId — Flutter TeamRepository uses this path
router.post('/acknowledge/:broadcastId', acknowledgeLimiter, EmergencyController.acknowledgeByParam);

module.exports = router;
