/**
 * Real-Time Portal Routes
 * API routes for real-time client portal features
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const realtimePortalController = require('../controllers/realtimePortalController');
const { authenticateUser } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

router.use(authenticateUser);

const familyReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many family access requests.' },
});

const familyWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many family access changes.' },
});

const familyInviteValidation = [
  body('clientId').isMongoId().withMessage('Invalid client ID'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Name is required'),
  body('relationship')
    .isString()
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Relationship is required'),
  body('role')
    .optional()
    .isIn(['family', 'guardian', 'viewer'])
    .withMessage('Invalid family role'),
  body('permissions').optional().isObject().withMessage('Permissions must be an object'),
];

const familyMembersValidation = [
  param('clientId').isMongoId().withMessage('Invalid client ID'),
];

const familyPermissionsValidation = [
  body('clientId').isMongoId().withMessage('Invalid client ID'),
  body('memberId').isMongoId().withMessage('Invalid family member ID'),
  body('permissions').isObject().withMessage('Permissions must be an object'),
];

const familyStatusValidation = [
  body('clientId').isMongoId().withMessage('Invalid client ID'),
  body('memberId').isMongoId().withMessage('Invalid family member ID'),
  body('status').isIn(['active', 'inactive']).withMessage('Invalid family status'),
];

// ============================================================================
// Real-Time Tracking Routes
// ============================================================================

// Start tracking session
router.post('/tracking/start', realtimePortalController.startTracking);

// Update worker location
router.post('/tracking/update', realtimePortalController.updateLocation);

// Stop tracking session
router.post('/tracking/stop', realtimePortalController.stopTracking);

// Get live tracking data
router.get('/tracking/live/:appointmentId', realtimePortalController.getLiveTracking);

// ============================================================================
// Messaging Routes
// ============================================================================

// Send message
router.post('/messages/send', realtimePortalController.sendMessage);

// Get messages for conversation
router.get('/messages/:conversationId', realtimePortalController.getMessages);

// Create conversation
router.post('/conversations/create', realtimePortalController.createConversation);

// Get user conversations
router.get('/conversations/user/:userId', realtimePortalController.getUserConversations);

// ============================================================================
// Digital Signature Routes
// ============================================================================

// Save signature
router.post('/signature/save', realtimePortalController.saveSignature);

// Submit service confirmation
router.post('/service-confirmation/submit', realtimePortalController.submitServiceConfirmation);

// Get service confirmation
router.get('/service-confirmation/:appointmentId', realtimePortalController.getServiceConfirmation);

// Get checklist template
router.get('/checklist/:serviceType', realtimePortalController.getChecklistTemplate);

// ============================================================================
// Family Access Routes
// ============================================================================

// Invite family member
router.post(
  '/family/invite',
  familyWriteLimiter,
  familyInviteValidation,
  handleValidationErrors,
  realtimePortalController.inviteFamilyMember
);

// Get family members
router.get(
  '/family/members/:clientId',
  familyReadLimiter,
  familyMembersValidation,
  handleValidationErrors,
  realtimePortalController.getFamilyMembers
);

// Update permissions
router.put(
  '/family/permissions',
  familyWriteLimiter,
  familyPermissionsValidation,
  handleValidationErrors,
  realtimePortalController.updatePermissions
);

// Update member status
router.put(
  '/family/status',
  familyWriteLimiter,
  familyStatusValidation,
  handleValidationErrors,
  realtimePortalController.updateFamilyMemberStatus
);

// Get access log
router.get(
  '/family/access-log/:clientId',
  familyReadLimiter,
  familyMembersValidation,
  handleValidationErrors,
  realtimePortalController.getAccessLog
);

module.exports = router;
