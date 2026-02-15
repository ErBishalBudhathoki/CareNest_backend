/**
 * Real-Time Portal Routes
 * API routes for real-time client portal features
 */

const express = require('express');
const router = express.Router();
const realtimePortalController = require('../controllers/realtimePortalController');

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
router.post('/family/invite', realtimePortalController.inviteFamilyMember);

// Get family members
router.get('/family/members/:clientId', realtimePortalController.getFamilyMembers);

// Update permissions
router.put('/family/permissions', realtimePortalController.updatePermissions);

// Get access log
router.get('/family/access-log/:clientId', realtimePortalController.getAccessLog);

module.exports = router;

