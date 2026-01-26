const EmployeeDocument = require('../models/EmployeeDocument');

class ComplianceService {
  /**
   * Get compliance summary for an organization
   * @param {String} organizationId
   */
  async getComplianceSummary(organizationId) {
    try {
      // 1. Get Expiring Documents (next 30 days)
      const now = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(now.getDate() + 30);

      const expiringDocs = await EmployeeDocument.find({
        organizationId,
        expiryDate: { $gte: now, $lte: thirtyDaysFromNow }
      }).lean();

      const expiredDocs = await EmployeeDocument.find({
        organizationId,
        expiryDate: { $lt: now }
      }).lean();

      // 2. Get Training Completion Stats (if model exists)
      // Assuming simple aggregation or placeholder if model not robust
      // const trainingStats = ...

      return {
        expiringCount: expiringDocs.length,
        expiredCount: expiredDocs.length,
        expiringDocs,
        expiredDocs,
        complianceScore: 85 // Placeholder or calculated
      };
    } catch (error) {
      throw new Error(`Error fetching compliance summary: ${error.message}`);
    }
  }
}

module.exports = new ComplianceService();
