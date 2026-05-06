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
  body('teamIds').isArray().withMessage('teamIds must be an array'),
  body('teamIds.*').isMongoId().withMessage('Invalid team ID in array'),
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
router.put('/:teamId', teamLimiter, teamIdValidation, handleValidationErrors, TeamController.update);
router.delete('/:teamId', teamLimiter, teamIdValidation, handleValidationErrors, TeamController.delete);
router.put('/:teamId/squash', teamLimiter, teamIdValidation, handleValidationErrors, TeamController.squash);
router.post('/:teamId/invite', teamLimiter, inviteValidation, handleValidationErrors, TeamController.inviteMember);

router.get('/:teamId/availability', teamLimiter, teamIdValidation, handleValidationErrors, TeamController.getAvailability);
router.put('/status', teamLimiter, statusValidation, handleValidationErrors, TeamController.updateStatus);

module.exports = router;
