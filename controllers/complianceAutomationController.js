const complianceAutomationService = require('../services/complianceAutomationService');

/**
 * Compliance Automation Controller
 * Handles compliance automation API endpoints
 */

class ComplianceAutomationController {
  /**
   * Run compliance scan for organization
   * GET /api/compliance/scan/:organizationId
   */
  async scanCompliance(req, res) {
    try {
      const { organizationId } = req.params;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }
      
      const result = await complianceAutomationService.scanCompliance(organizationId);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in scanCompliance controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get compliance score for worker
   * GET /api/compliance/score/:workerId
   */
  async getComplianceScore(req, res) {
    try {
      const { workerId } = req.params;
      
      if (!workerId) {
        return res.status(400).json({
          success: false,
          message: 'Worker ID is required'
        });
      }
      
      // In production, fetch worker data and calculate score
      // For now, return mock score
      const score = complianceAutomationService.calculateComplianceScore({
        totalWorkers: 1,
        compliantWorkers: 1,
        issues: 0,
        warnings: 1
      });
      
      return res.status(200).json({
        success: true,
        data: {
          workerId,
          ...score,
          lastChecked: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error in getComplianceScore controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get expiring documents
   * GET /api/compliance/expiring/:organizationId?daysAhead=90
   */
  async getExpiringDocuments(req, res) {
    try {
      const { organizationId } = req.params;
      const { daysAhead } = req.query;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }
      
      const days = daysAhead ? parseInt(daysAhead) : 90;
      const expiringDocs = await complianceAutomationService.checkExpiringDocuments(
        organizationId,
        days
      );
      
      return res.status(200).json({
        success: true,
        data: {
          organizationId,
          daysAhead: days,
          count: expiringDocs.length,
          documents: expiringDocs
        }
      });
    } catch (error) {
      console.error('Error in getExpiringDocuments controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Generate compliance report
   * POST /api/compliance/report
   * Body: { organizationId, reportType }
   */
  async generateComplianceReport(req, res) {
    try {
      const { organizationId, reportType } = req.body;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }
      
      const validReportTypes = ['summary', 'detailed', 'audit'];
      const type = validReportTypes.includes(reportType) ? reportType : 'summary';
      
      const result = await complianceAutomationService.generateComplianceReport(
        organizationId,
        type
      );
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in generateComplianceReport controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get compliance trends
   * GET /api/compliance/trends/:organizationId?months=6
   */
  async getComplianceTrends(req, res) {
    try {
      const { organizationId } = req.params;
      const { months } = req.query;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }
      
      const monthCount = months ? parseInt(months) : 6;
      const result = await complianceAutomationService.getComplianceTrends(
        organizationId,
        monthCount
      );
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in getComplianceTrends controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Send compliance alerts
   * POST /api/compliance/alerts
   * Body: { organizationId, alerts }
   */
  async sendComplianceAlerts(req, res) {
    try {
      const { organizationId, alerts } = req.body;
      
      if (!organizationId || !alerts || !Array.isArray(alerts)) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID and alerts array are required'
        });
      }
      
      const result = await complianceAutomationService.sendComplianceAlerts(
        organizationId,
        alerts
      );
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in sendComplianceAlerts controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new ComplianceAutomationController();
