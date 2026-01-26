const crossOrgService = require('../services/crossOrgService');
const organizationService = require('../services/organizationService');
const logger = require('../config/logger');

class MultiTenantController {
  async getCrossOrgReport(req, res) {
    try {
      const { type, startDate, endDate } = req.query;
      const userId = req.user.userId;

      if (type !== 'revenue') {
        return res.status(400).json({ message: 'Only revenue reports are currently supported' });
      }

      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required' });
      }

      const report = await crossOrgService.getCrossOrgRevenue(userId, startDate, endDate);
      
      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error('Error generating cross-org report', { error: error.message, userId: req.user.userId });
      res.status(500).json({ message: 'Error generating report' });
    }
  }

  async addSharedEmployee(req, res) {
    try {
      const { organizationId } = req.params; // Target organization
      const { employeeId, assignmentType, costAllocation, hourlyRate, startDate, endDate } = req.body;

      // Validate input
      if (!employeeId || !assignmentType || !startDate) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Check permissions (assuming middleware handles basic checks, but we verify ownership/admin here)
      // Note: req.organizationContext might be for the CURRENT context, but we are adding to TARGET context.
      // If user is adding to "organizationId", they must be admin/owner of "organizationId".
      // We rely on middleware to enforce that if route is /organizations/:organizationId/shared-employees
      
      const assignment = await organizationService.addSharedEmployee(employeeId, organizationId, {
        assignmentType,
        costAllocation,
        hourlyRate,
        startDate,
        endDate
      });

      res.status(201).json({
        success: true,
        message: 'Shared employee added successfully',
        data: assignment
      });
    } catch (error) {
      logger.error('Error adding shared employee', { error: error.message });
      res.status(500).json({ message: error.message });
    }
  }
}

module.exports = new MultiTenantController();
