const express = require('express');
const router = express.Router();
const complianceAutomationController = require('../controllers/complianceAutomationController');

// Run compliance scan
router.get('/scan/:organizationId', complianceAutomationController.scanCompliance);

// Get compliance score for worker
router.get('/score/:workerId', complianceAutomationController.getComplianceScore);

// Get expiring documents
router.get('/expiring/:organizationId', complianceAutomationController.getExpiringDocuments);

// Generate compliance report
router.post('/report', complianceAutomationController.generateComplianceReport);

// Get compliance trends
router.get('/trends/:organizationId', complianceAutomationController.getComplianceTrends);

// Send compliance alerts
router.post('/alerts', complianceAutomationController.sendComplianceAlerts);

module.exports = router;
