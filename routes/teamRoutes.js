const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const TeamController = require('../controllers/teamController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const teamLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

const broadcastLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10, // Restrict broadcasts
  message: { success: false, message: 'Too many broadcasts.' }
});

// Validation
const createTeamValidation = [
  body('name').trim().notEmpty().withMessage('Team name is required'),
  body('name').isLength({ max: 100 }).withMessage('Team name too long'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('organizationId').optional().isMongoId().withMessage('Invalid organization ID')
];

const inviteValidation = [
  param('teamId').isMongoId().withMessage('Invalid team ID'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('role').optional().isIn(['member', 'admin', 'manager']).withMessage('Role must be member, admin, or manager')
];

const broadcastValidation = [
  body('teamId').isMongoId().withMessage('Invalid team ID'),
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('message').isLength({ max: 1000 }).withMessage('Message too long'),
  body('type').optional().isIn(['medical', 'fire', 'security', 'alert']).withMessage('Invalid broadcast type')
];

const statusValidation = [
  body('teamId').isMongoId().withMessage('Invalid team ID'),
  body('status').trim().notEmpty().withMessage('Status is required'),
  body('status').isLength({ max: 50 }).withMessage('Status too long')
];

const teamIdValidation = [
  param('teamId').isMongoId().withMessage('Invalid team ID')
];

const broadcastIdValidation = [
  param('id').isMongoId().withMessage('Invalid broadcast ID')
];

// Protected routes
router.use(authenticateUser);

// Teams
router.get('/my-teams', teamLimiter, TeamController.getMyTeams);
router.post('/', teamLimiter, createTeamValidation, handleValidationErrors, TeamController.create);
router.post('/:teamId/invite', teamLimiter, inviteValidation, handleValidationErrors, TeamController.inviteMember);

// Availability
router.get('/:teamId/availability', teamLimiter, teamIdValidation, handleValidationErrors, TeamController.getAvailability);
router.put('/status', teamLimiter, statusValidation, handleValidationErrors, TeamController.updateStatus);

// Emergency
router.post('/emergency/broadcast', broadcastLimiter, broadcastValidation, handleValidationErrors, TeamController.sendBroadcast);
router.get('/emergency/active', teamLimiter, TeamController.getActiveBroadcasts);
router.post('/emergency/acknowledge/:id', teamLimiter, broadcastIdValidation, handleValidationErrors, TeamController.acknowledgeBroadcast);

module.exports = router;
