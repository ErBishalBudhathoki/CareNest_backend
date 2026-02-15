/**
 * Compliance Automation Service
 * Automated compliance management with alerts and scoring
 */

class ComplianceAutomationService {
  /**
   * Run daily compliance scan for organization
   * @param {string} organizationId - Organization ID
   * @returns {Object} Scan results with issues found
   */
  async scanCompliance(organizationId) {
    try {
      // In production, query User model for all workers in organization
      // For now, return mock scan results
      
      const issues = [];
      const warnings = [];
      
      // Mock: Check for expiring certifications
      const expiringDocs = await this.checkExpiringDocuments(organizationId, 30);
      if (expiringDocs.length > 0) {
        warnings.push({
          type: 'expiring_documents',
          count: expiringDocs.length,
          message: `${expiringDocs.length} documents expiring in next 30 days`,
          severity: 'medium'
        });
      }
      
      // Mock: Check for missing documents
      const missingDocs = 5; // In production, count workers with missing docs
      if (missingDocs > 0) {
        issues.push({
          type: 'missing_documents',
          count: missingDocs,
          message: `${missingDocs} workers have missing required documents`,
          severity: 'high'
        });
      }
      
      // Mock: Check for expired certifications
      const expiredCerts = 2; // In production, count expired certs
      if (expiredCerts > 0) {
        issues.push({
          type: 'expired_certifications',
          count: expiredCerts,
          message: `${expiredCerts} workers have expired certifications`,
          severity: 'critical'
        });
      }
      
      const complianceScore = this.calculateComplianceScore({
        totalWorkers: 50,
        compliantWorkers: 43,
        issues: issues.length,
        warnings: warnings.length
      });
      
      return {
        success: true,
        data: {
          organizationId,
          scanDate: new Date().toISOString(),
          complianceScore,
          issues,
          warnings,
          summary: {
            totalIssues: issues.length,
            totalWarnings: warnings.length,
            criticalCount: issues.filter(i => i.severity === 'critical').length,
            highCount: issues.filter(i => i.severity === 'high').length,
            mediumCount: warnings.filter(w => w.severity === 'medium').length
          }
        }
      };
    } catch (error) {
      console.error('Error scanning compliance:', error);
      return {
        success: false,
        message: 'Failed to scan compliance',
        error: error.message
      };
    }
  }
  
  /**
   * Check for expiring documents
   * @param {string} organizationId - Organization ID
   * @param {number} daysAhead - Days to look ahead (default 90)
   * @returns {Array} List of expiring documents
   */
  async checkExpiringDocuments(organizationId, daysAhead = 90) {
    try {
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + daysAhead);
      
      // In production, query User model for workers with expiring docs
      // For now, return mock data
      
      const expiringDocs = [
        {
          workerId: 'worker1',
          workerName: 'John Smith',
          documentType: 'First Aid Certificate',
          expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
          daysUntilExpiry: 15,
          severity: 'high'
        },
        {
          workerId: 'worker2',
          workerName: 'Jane Doe',
          documentType: 'Police Check',
          expiryDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
          daysUntilExpiry: 45,
          severity: 'medium'
        },
        {
          workerId: 'worker3',
          workerName: 'Bob Johnson',
          documentType: 'NDIS Worker Screening',
          expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          daysUntilExpiry: 7,
          severity: 'critical'
        }
      ];
      
      return expiringDocs.filter(doc => doc.daysUntilExpiry <= daysAhead);
    } catch (error) {
      console.error('Error checking expiring documents:', error);
      return [];
    }
  }
  
  /**
   * Calculate compliance score for worker or organization
   * @param {Object} data - Compliance data
   * @returns {Object} Compliance score with breakdown
   */
  calculateComplianceScore(data) {
    const {
      totalWorkers = 1,
      compliantWorkers = 0,
      issues = 0,
      warnings = 0
    } = data;
    
    // Base score from compliant workers (0-70 points)
    const baseScore = (compliantWorkers / totalWorkers) * 70;
    
    // Deduct points for issues (up to -30 points)
    const issueDeduction = Math.min(issues * 5, 30);
    
    // Deduct points for warnings (up to -10 points)
    const warningDeduction = Math.min(warnings * 2, 10);
    
    // Calculate final score (0-100)
    const score = Math.max(0, Math.min(100, baseScore - issueDeduction - warningDeduction));
    
    // Determine risk level
    let riskLevel = 'low';
    if (score < 50) riskLevel = 'critical';
    else if (score < 70) riskLevel = 'high';
    else if (score < 85) riskLevel = 'medium';
    
    return {
      score: Math.round(score),
      riskLevel,
      breakdown: {
        baseScore: Math.round(baseScore),
        issueDeduction,
        warningDeduction,
        compliantWorkers,
        totalWorkers,
        complianceRate: Math.round((compliantWorkers / totalWorkers) * 100)
      }
    };
  }
  
  /**
   * Generate compliance report
   * @param {string} organizationId - Organization ID
   * @param {string} reportType - Report type (summary, detailed, audit)
   * @returns {Object} Generated report
   */
  async generateComplianceReport(organizationId, reportType = 'summary') {
    try {
      const scanResults = await this.scanCompliance(organizationId);
      const expiringDocs = await this.checkExpiringDocuments(organizationId, 90);
      
      const report = {
        reportId: `COMP-${Date.now()}`,
        organizationId,
        reportType,
        generatedDate: new Date().toISOString(),
        complianceScore: scanResults.data.complianceScore,
        summary: scanResults.data.summary,
        expiringDocuments: expiringDocs,
        recommendations: this.generateRecommendations(scanResults.data)
      };
      
      if (reportType === 'detailed' || reportType === 'audit') {
        report.issues = scanResults.data.issues;
        report.warnings = scanResults.data.warnings;
      }
      
      if (reportType === 'audit') {
        report.auditTrail = {
          lastAuditDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
          nextAuditDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          complianceHistory: []
        };
      }
      
      return {
        success: true,
        data: report
      };
    } catch (error) {
      console.error('Error generating compliance report:', error);
      return {
        success: false,
        message: 'Failed to generate report',
        error: error.message
      };
    }
  }
  
  /**
   * Generate recommendations based on scan results
   * @param {Object} scanData - Scan results
   * @returns {Array} List of recommendations
   */
  generateRecommendations(scanData) {
    const recommendations = [];
    
    if (scanData.complianceScore.score < 70) {
      recommendations.push({
        priority: 'high',
        action: 'Immediate Action Required',
        description: 'Compliance score is below acceptable threshold. Address critical issues immediately.'
      });
    }
    
    if (scanData.summary.criticalCount > 0) {
      recommendations.push({
        priority: 'critical',
        action: 'Resolve Critical Issues',
        description: `${scanData.summary.criticalCount} critical compliance issues require immediate attention.`
      });
    }
    
    if (scanData.summary.totalWarnings > 5) {
      recommendations.push({
        priority: 'medium',
        action: 'Review Warnings',
        description: 'Multiple warnings detected. Schedule time to address these proactively.'
      });
    }
    
    recommendations.push({
      priority: 'low',
      action: 'Schedule Regular Audits',
      description: 'Maintain compliance by scheduling quarterly compliance audits.'
    });
    
    return recommendations;
  }
  
  /**
   * Get compliance trends over time
   * @param {string} organizationId - Organization ID
   * @param {number} months - Number of months to analyze
   * @returns {Object} Trend data
   */
  async getComplianceTrends(organizationId, months = 6) {
    try {
      // In production, query historical compliance data
      // For now, return mock trend data
      
      const trends = [];
      const today = new Date();
      
      for (let i = months - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setMonth(date.getMonth() - i);
        
        // Mock: Generate trend data with slight improvement over time
        const baseScore = 75 + (months - i) * 2;
        const score = Math.min(95, baseScore + Math.random() * 5);
        
        trends.push({
          month: date.toISOString().substring(0, 7), // YYYY-MM format
          score: Math.round(score),
          issues: Math.max(0, Math.round(10 - i)),
          warnings: Math.max(0, Math.round(15 - i * 1.5)),
          compliantWorkers: Math.round(45 + i * 0.5)
        });
      }
      
      // Calculate trend direction
      const firstScore = trends[0].score;
      const lastScore = trends[trends.length - 1].score;
      const trendDirection = lastScore > firstScore ? 'improving' : 
                            lastScore < firstScore ? 'declining' : 'stable';
      
      return {
        success: true,
        data: {
          organizationId,
          period: `${months} months`,
          trendDirection,
          trends,
          summary: {
            averageScore: Math.round(trends.reduce((sum, t) => sum + t.score, 0) / trends.length),
            highestScore: Math.max(...trends.map(t => t.score)),
            lowestScore: Math.min(...trends.map(t => t.score)),
            improvement: lastScore - firstScore
          }
        }
      };
    } catch (error) {
      console.error('Error getting compliance trends:', error);
      return {
        success: false,
        message: 'Failed to get trends',
        error: error.message
      };
    }
  }
  
  /**
   * Send compliance alerts
   * @param {string} organizationId - Organization ID
   * @param {Array} alerts - Alerts to send
   * @returns {Object} Send results
   */
  async sendComplianceAlerts(organizationId, alerts) {
    try {
      // In production, integrate with notification service
      // For now, return mock success
      
      const sentAlerts = alerts.map(alert => ({
        ...alert,
        sentDate: new Date().toISOString(),
        status: 'sent'
      }));
      
      return {
        success: true,
        data: {
          totalSent: sentAlerts.length,
          alerts: sentAlerts
        }
      };
    } catch (error) {
      console.error('Error sending compliance alerts:', error);
      return {
        success: false,
        message: 'Failed to send alerts',
        error: error.message
      };
    }
  }
}

module.exports = new ComplianceAutomationService();
