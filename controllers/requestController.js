const requestService = require('../services/requestService');
const logger = require('../config/logger');

class RequestController {
  async createRequest(req, res) {
    try {
      const { organizationId, userId, type, details, userEmail } = req.body;

      if (!organizationId || !userId || !type || !details) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields'
        });
      }

      const request = await requestService.createRequest(req.body, userEmail);
      res.status(201).json({
        success: true,
        data: request
      });
    } catch (error) {
      logger.error('Error creating request', error);
      res.status(500).json({
        success: false,
        message: 'Error creating request'
      });
    }
  }

  async getRequests(req, res) {
    try {
      const { organizationId } = req.params;
      const filters = req.query;
      const requests = await requestService.getRequests(organizationId, filters);
      res.status(200).json({
        success: true,
        data: requests
      });
    } catch (error) {
      logger.error('Error fetching requests', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching requests'
      });
    }
  }

  async updateRequestStatus(req, res) {
    try {
      const { requestId } = req.params;
      const { status, userEmail, reason } = req.body;
      const request = await requestService.updateRequestStatus(requestId, status, userEmail, reason);
      res.status(200).json({
        success: true,
        data: request
      });
    } catch (error) {
      logger.error('Error updating request status', error);
      res.status(500).json({
        success: false,
        message: 'Error updating request status'
      });
    }
  }
}

module.exports = new RequestController();
