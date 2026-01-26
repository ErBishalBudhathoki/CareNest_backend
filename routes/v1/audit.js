/**
 * Audit Trail Routes
 * Express router for audit trail functionality
 * 
 * @file backend/routes/v1/audit.js
 */

const express = require('express');
const AuditController = require('../../controllers/auditController');
const router = express.Router();

// Get audit history for a specific entity
// GET /api/audit/entity/:entityType/:entityId
router.get('/entity/:entityType/:entityId', AuditController.getEntityAuditHistory);

// Get organization audit logs with filtering
// GET /api/audit/organization/:organizationId
router.get('/organization/:organizationId', AuditController.getOrganizationAuditLogs);

// Get audit statistics for an organization
// GET /api/audit/statistics/:organizationId
router.get('/statistics/:organizationId', AuditController.getAuditStatistics);

// Create a manual audit log entry
// POST /api/audit/log
router.post('/log', AuditController.createAuditLog);

// Get available audit actions and entity types
// GET /api/audit/metadata
router.get('/metadata', AuditController.getAuditMetadata);

// Export audit logs for compliance reporting
// GET /api/audit/export/:organizationId
router.get('/export/:organizationId', AuditController.exportAuditLogs);

module.exports = router;
