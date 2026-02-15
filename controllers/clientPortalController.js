const clientPortalService = require('../services/clientPortalService');

/**
 * Client Portal Controller
 * Handles client portal API endpoints
 */

class ClientPortalController {
  /**
   * Get client dashboard
   * GET /api/client-portal/dashboard/:clientId
   */
  async getClientDashboard(req, res) {
    try {
      const { clientId } = req.params;
      
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required'
        });
      }
      
      const result = await clientPortalService.getClientDashboard(clientId);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in getClientDashboard controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get worker location
   * GET /api/client-portal/worker-location/:appointmentId
   */
  async getWorkerLocation(req, res) {
    try {
      const { appointmentId } = req.params;
      
      if (!appointmentId) {
        return res.status(400).json({
          success: false,
          message: 'Appointment ID is required'
        });
      }
      
      const result = await clientPortalService.getWorkerLocation(appointmentId);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in getWorkerLocation controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get appointment status
   * GET /api/client-portal/appointment-status/:appointmentId
   */
  async getAppointmentStatus(req, res) {
    try {
      const { appointmentId } = req.params;
      
      if (!appointmentId) {
        return res.status(400).json({
          success: false,
          message: 'Appointment ID is required'
        });
      }
      
      const result = await clientPortalService.getAppointmentStatus(appointmentId);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in getAppointmentStatus controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Send client message
   * POST /api/client-portal/message
   * Body: { clientId, workerId, appointmentId, message, messageType }
   */
  async sendClientMessage(req, res) {
    try {
      const messageData = req.body;
      
      if (!messageData.clientId || !messageData.workerId || !messageData.message) {
        return res.status(400).json({
          success: false,
          message: 'Client ID, worker ID, and message are required'
        });
      }
      
      const result = await clientPortalService.sendClientMessage(messageData);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(400).json(result);
      }
    } catch (error) {
      console.error('Error in sendClientMessage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Submit service feedback
   * POST /api/client-portal/feedback
   * Body: { clientId, appointmentId, rating, comments, categories }
   */
  async submitServiceFeedback(req, res) {
    try {
      const feedbackData = req.body;
      
      if (!feedbackData.clientId || !feedbackData.appointmentId || !feedbackData.rating) {
        return res.status(400).json({
          success: false,
          message: 'Client ID, appointment ID, and rating are required'
        });
      }
      
      const result = await clientPortalService.submitServiceFeedback(feedbackData);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(400).json(result);
      }
    } catch (error) {
      console.error('Error in submitServiceFeedback controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get service history
   * GET /api/client-portal/service-history/:clientId?limit=10
   */
  async getServiceHistory(req, res) {
    try {
      const { clientId } = req.params;
      const { limit } = req.query;
      
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: 'Client ID is required'
        });
      }
      
      const limitNum = limit ? parseInt(limit) : 10;
      const result = await clientPortalService.getServiceHistory(clientId, limitNum);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in getServiceHistory controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new ClientPortalController();
