const workedTimeService = require('../services/workedTimeService');
const logger = require('../config/logger');

class WorkedTimeController {
  async getVisitHistory(req, res) {
    try {
      const { clientId } = req.params;
      const { organizationId, userEmail } = req.query; // Assuming query params for filters

      if (!organizationId) {
        return res.status(400).json({
          statusCode: 400,
          message: "Organization ID is required"
        });
      }

      const result = await workedTimeService.getVisitHistory(clientId, organizationId, userEmail);
      res.status(200).json({
        statusCode: 200,
        ...result
      });
    } catch (error) {
      logger.error('Visit history fetch failed', {
        error: error.message,
        stack: error.stack,
        clientId: req.params.clientId
      });

      if (error.message === 'Client not found or access denied') {
        return res.status(404).json({
          statusCode: 404,
          message: error.message
        });
      }

      res.status(500).json({
        statusCode: 500,
        message: "Error retrieving visit history"
      });
    }
  }

  async getRecentVisits(req, res) {
    try {
      const { userEmail } = req.params;
      const { limit } = req.query;

      const result = await workedTimeService.getRecentVisits(userEmail, parseInt(limit) || 5);
      res.status(200).json({
        statusCode: 200,
        ...result
      });
    } catch (error) {
      logger.error('Recent visits fetch failed', {
        error: error.message,
        stack: error.stack,
        userEmail: req.params.userEmail
      });

      res.status(500).json({
        statusCode: 500,
        message: "Error retrieving recent visits"
      });
    }
  }
}

module.exports = new WorkedTimeController();
