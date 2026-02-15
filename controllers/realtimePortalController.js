/**
 * Real-Time Portal Controller
 * Handles API endpoints for real-time client portal features
 */

const realtimeTrackingService = require('../services/realtimeTrackingService');
const messagingService = require('../services/messagingService');
const digitalSignatureService = require('../services/digitalSignatureService');
const familyAccessService = require('../services/familyAccessService');

// ============================================================================
// Real-Time Tracking Endpoints
// ============================================================================

/**
 * Start tracking session
 * POST /api/realtime-portal/tracking/start
 */
exports.startTracking = async (req, res) => {
  try {
    const { appointmentId, workerId, clientLocation } = req.body;

    if (!appointmentId || !workerId || !clientLocation) {
      return res.status(400).json({
        success: false,
        message: 'appointmentId, workerId, and clientLocation are required',
      });
    }

    const session = await realtimeTrackingService.startTrackingSession({
      appointmentId,
      workerId,
      clientLocation,
    });

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error('Error starting tracking:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting tracking session',
      error: error.message,
    });
  }
};

/**
 * Update worker location
 * POST /api/realtime-portal/tracking/update
 */
exports.updateLocation = async (req, res) => {
  try {
    const { appointmentId, workerId, latitude, longitude, accuracy } = req.body;

    if (!appointmentId || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'appointmentId, latitude, and longitude are required',
      });
    }

    const locationData = await realtimeTrackingService.updateWorkerLocation({
      appointmentId,
      workerId,
      latitude,
      longitude,
      accuracy: accuracy || 10,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      data: locationData,
    });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message,
    });
  }
};

/**
 * Stop tracking session
 * POST /api/realtime-portal/tracking/stop
 */
exports.stopTracking = async (req, res) => {
  try {
    const { appointmentId } = req.body;

    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: 'appointmentId is required',
      });
    }

    const summary = await realtimeTrackingService.stopTrackingSession({
      appointmentId,
    });

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error stopping tracking:', error);
    res.status(500).json({
      success: false,
      message: 'Error stopping tracking session',
      error: error.message,
    });
  }
};

/**
 * Get live tracking data
 * GET /api/realtime-portal/tracking/live/:appointmentId
 */
exports.getLiveTracking = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const trackingData = await realtimeTrackingService.getLiveTrackingData(appointmentId);

    if (!trackingData) {
      return res.status(404).json({
        success: false,
        message: 'No active tracking session found',
      });
    }

    res.json({
      success: true,
      data: trackingData,
    });
  } catch (error) {
    console.error('Error getting live tracking:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting live tracking data',
      error: error.message,
    });
  }
};

// ============================================================================
// Messaging Endpoints
// ============================================================================

/**
 * Send message
 * POST /api/realtime-portal/messages/send
 */
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, senderId, senderType, recipientId, message, attachments } = req.body;

    if (!conversationId || !senderId || !recipientId || !message) {
      return res.status(400).json({
        success: false,
        message: 'conversationId, senderId, recipientId, and message are required',
      });
    }

    const messageData = await messagingService.sendMessage({
      conversationId,
      senderId,
      senderType: senderType || 'client',
      recipientId,
      message,
      attachments,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      data: messageData,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: error.message,
    });
  }
};

/**
 * Get messages
 * GET /api/realtime-portal/messages/:conversationId
 */
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit, before } = req.query;

    const messages = await messagingService.getMessages(conversationId, {
      limit: limit ? parseInt(limit) : 50,
      before,
    });

    res.json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting messages',
      error: error.message,
    });
  }
};

/**
 * Create conversation
 * POST /api/realtime-portal/conversations/create
 */
exports.createConversation = async (req, res) => {
  try {
    const { appointmentId, clientId, workerId, organizationId } = req.body;

    if (!appointmentId || !clientId || !workerId) {
      return res.status(400).json({
        success: false,
        message: 'appointmentId, clientId, and workerId are required',
      });
    }

    const conversation = await messagingService.createConversation({
      appointmentId,
      clientId,
      workerId,
      organizationId,
    });

    res.json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating conversation',
      error: error.message,
    });
  }
};

/**
 * Get user conversations
 * GET /api/realtime-portal/conversations/user/:userId
 */
exports.getUserConversations = async (req, res) => {
  try {
    const { userId } = req.params;

    const conversations = await messagingService.getUserConversations(userId);

    res.json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting conversations',
      error: error.message,
    });
  }
};

// ============================================================================
// Digital Signature Endpoints
// ============================================================================

/**
 * Save signature
 * POST /api/realtime-portal/signature/save
 */
exports.saveSignature = async (req, res) => {
  try {
    const { appointmentId, clientId, signatureData } = req.body;

    if (!appointmentId || !clientId || !signatureData) {
      return res.status(400).json({
        success: false,
        message: 'appointmentId, clientId, and signatureData are required',
      });
    }

    const signature = await digitalSignatureService.saveSignature({
      appointmentId,
      clientId,
      signatureData,
      timestamp: new Date(),
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
    });

    res.json({
      success: true,
      data: signature,
    });
  } catch (error) {
    console.error('Error saving signature:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving signature',
      error: error.message,
    });
  }
};

/**
 * Submit service confirmation
 * POST /api/realtime-portal/service-confirmation/submit
 */
exports.submitServiceConfirmation = async (req, res) => {
  try {
    const {
      appointmentId,
      clientId,
      workerId,
      signatureId,
      rating,
      feedback,
      checklist,
      photos,
      incidents,
    } = req.body;

    if (!appointmentId || !clientId || !workerId || !signatureId) {
      return res.status(400).json({
        success: false,
        message: 'appointmentId, clientId, workerId, and signatureId are required',
      });
    }

    const confirmation = await digitalSignatureService.submitServiceConfirmation({
      appointmentId,
      clientId,
      workerId,
      signatureId,
      rating,
      feedback,
      checklist,
      photos,
      incidents,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      data: confirmation,
    });
  } catch (error) {
    console.error('Error submitting confirmation:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting service confirmation',
      error: error.message,
    });
  }
};

/**
 * Get service confirmation
 * GET /api/realtime-portal/service-confirmation/:appointmentId
 */
exports.getServiceConfirmation = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const confirmation = await digitalSignatureService.getServiceConfirmation(appointmentId);

    if (!confirmation) {
      return res.status(404).json({
        success: false,
        message: 'Service confirmation not found',
      });
    }

    res.json({
      success: true,
      data: confirmation,
    });
  } catch (error) {
    console.error('Error getting confirmation:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting service confirmation',
      error: error.message,
    });
  }
};

/**
 * Get checklist template
 * GET /api/realtime-portal/checklist/:serviceType
 */
exports.getChecklistTemplate = async (req, res) => {
  try {
    const { serviceType } = req.params;

    const checklist = await digitalSignatureService.getChecklistTemplate(serviceType);

    res.json({
      success: true,
      data: checklist,
    });
  } catch (error) {
    console.error('Error getting checklist:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting checklist template',
      error: error.message,
    });
  }
};

// ============================================================================
// Family Access Endpoints
// ============================================================================

/**
 * Invite family member
 * POST /api/realtime-portal/family/invite
 */
exports.inviteFamilyMember = async (req, res) => {
  try {
    const { clientId, invitedBy, email, name, relationship, role, permissions } = req.body;

    if (!clientId || !invitedBy || !email || !name || !relationship) {
      return res.status(400).json({
        success: false,
        message: 'clientId, invitedBy, email, name, and relationship are required',
      });
    }

    const invitation = await familyAccessService.inviteFamilyMember({
      clientId,
      invitedBy,
      email,
      name,
      relationship,
      role: role || 'family',
      permissions,
    });

    res.json({
      success: true,
      data: invitation,
    });
  } catch (error) {
    console.error('Error inviting family member:', error);
    res.status(500).json({
      success: false,
      message: 'Error inviting family member',
      error: error.message,
    });
  }
};

/**
 * Get family members
 * GET /api/realtime-portal/family/members/:clientId
 */
exports.getFamilyMembers = async (req, res) => {
  try {
    const { clientId } = req.params;

    const members = await familyAccessService.getFamilyMembers(clientId);

    res.json({
      success: true,
      data: members,
    });
  } catch (error) {
    console.error('Error getting family members:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting family members',
      error: error.message,
    });
  }
};

/**
 * Update permissions
 * PUT /api/realtime-portal/family/permissions
 */
exports.updatePermissions = async (req, res) => {
  try {
    const { clientId, memberId, permissions, updatedBy } = req.body;

    if (!clientId || !memberId || !permissions || !updatedBy) {
      return res.status(400).json({
        success: false,
        message: 'clientId, memberId, permissions, and updatedBy are required',
      });
    }

    const member = await familyAccessService.updatePermissions({
      clientId,
      memberId,
      permissions,
      updatedBy,
    });

    res.json({
      success: true,
      data: member,
    });
  } catch (error) {
    console.error('Error updating permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating permissions',
      error: error.message,
    });
  }
};

/**
 * Get access log
 * GET /api/realtime-portal/family/access-log/:clientId
 */
exports.getAccessLog = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { limit, startDate, endDate } = req.query;

    const logs = await familyAccessService.getAccessLog(clientId, {
      limit: limit ? parseInt(limit) : 100,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error('Error getting access log:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting access log',
      error: error.message,
    });
  }
};

