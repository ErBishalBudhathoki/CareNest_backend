const clientPortalService = require('../services/clientPortalService');

/**
 * Client Portal Controller
 * Handles client portal API endpoints
 */
const handleError = (res, error, fallbackMessage) => {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).json({
    success: false,
    message: error?.message || fallbackMessage,
    error:
      process.env.NODE_ENV === 'development'
          ? error?.stack || error?.message
          : undefined,
  });
};

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
          message: 'Client ID is required',
        });
      }

      const result = await clientPortalService.getClientDashboard(clientId, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getClientDashboard controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Get client appointments
   * GET /api/client-portal/appointments
   */
  async getAppointments(req, res) {
    try {
      const result = await clientPortalService.getAppointments(req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getAppointments controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Get appointment detail
   * GET /api/client-portal/appointments/:assignmentId/:scheduleId
   */
  async getAppointmentDetail(req, res) {
    try {
      const { assignmentId, scheduleId } = req.params;

      if (!assignmentId || !scheduleId) {
        return res.status(400).json({
          success: false,
          message: 'Assignment ID and schedule ID are required',
        });
      }

      const result = await clientPortalService.getAppointmentDetail(
        assignmentId,
        scheduleId,
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getAppointmentDetail controller:', error);
      return handleError(res, error, 'Internal server error');
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
          message: 'Appointment ID is required',
        });
      }

      const result = await clientPortalService.getWorkerLocation(appointmentId, req.user);
      const statusCode = result.success ? 200 : 403;
      return res.status(statusCode).json(result);
    } catch (error) {
      console.error('Error in getWorkerLocation controller:', error);
      return handleError(res, error, 'Internal server error');
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
          message: 'Appointment ID is required',
        });
      }

      const result = await clientPortalService.getAppointmentStatus(appointmentId, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getAppointmentStatus controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Send client message
   * POST /api/client-portal/message
   */
  async sendClientMessage(req, res) {
    try {
      const messageData = req.body || {};

      if (!messageData.appointmentId || !messageData.message) {
        return res.status(400).json({
          success: false,
          message: 'appointmentId and message are required',
        });
      }

      const result = await clientPortalService.sendClientMessage(messageData, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in sendClientMessage controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Submit service feedback
   * POST /api/client-portal/feedback
   */
  async submitServiceFeedback(req, res) {
    try {
      const feedbackData = req.body || {};

      if (!feedbackData.appointmentId || feedbackData.rating == null) {
        return res.status(400).json({
          success: false,
          message: 'appointmentId and rating are required',
        });
      }

      const result = await clientPortalService.submitServiceFeedback(feedbackData, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in submitServiceFeedback controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Get feedback feed for authenticated user context
   * GET /api/client-portal/feedback-feed?limit=20
   */
  async getFeedbackFeed(req, res) {
    try {
      const { limit } = req.query;
      const result = await clientPortalService.getFeedbackFeed({
        authUser: req.user,
        limit: limit || 20,
      });
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getFeedbackFeed controller:', error);
      return handleError(res, error, 'Internal server error');
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
          message: 'Client ID is required',
        });
      }

      const result = await clientPortalService.getServiceHistory(clientId, limit || 10, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getServiceHistory controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Get invoices
   * GET /api/client-portal/invoices
   */
  async getInvoices(req, res) {
    try {
      const result = await clientPortalService.getInvoices(req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getInvoices controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Get invoice detail
   * GET /api/client-portal/invoices/:id
   */
  async getInvoiceDetail(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Invoice ID is required',
        });
      }

      const result = await clientPortalService.getInvoiceDetail(id, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getInvoiceDetail controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Approve invoice
   * POST /api/client-portal/invoices/:id/approve
   */
  async approveInvoice(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Invoice ID is required',
        });
      }

      const result = await clientPortalService.approveInvoice(id, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in approveInvoice controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Dispute invoice
   * POST /api/client-portal/invoices/:id/dispute
   */
  async disputeInvoice(req, res) {
    try {
      const { id } = req.params;
      const reason = req.body?.reason;

      if (!id || !reason) {
        return res.status(400).json({
          success: false,
          message: 'Invoice ID and reason are required',
        });
      }

      const result = await clientPortalService.disputeInvoice(id, reason, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in disputeInvoice controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }

  /**
   * Request appointment
   * POST /api/client-portal/appointments/request
   */
  async requestAppointment(req, res) {
    try {
      const result = await clientPortalService.requestAppointment(req.body || {}, req.user);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in requestAppointment controller:', error);
      return handleError(res, error, 'Internal server error');
    }
  }
}

module.exports = new ClientPortalController();
