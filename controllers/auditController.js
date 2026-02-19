/**
 * Audit Trail Controller
 * Handles audit logging and retrieval requests
 * 
 * @file backend/controllers/auditController.js
 */

const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const {
  createAuditLog,
  getEntityAuditHistory,
  getOrganizationAuditLogs,
  getAuditStatistics,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES
} = require('../services/auditService');

/**
 * Helper to verify user access to organization
 */
async function verifyUserAccess(userEmail, organizationId) {
  if (!userEmail || !organizationId) return false;
  
  const user = await User.findOne({
    email: userEmail,
    organizationId: organizationId,
    isActive: { $ne: false }
  });
  
  return !!user;
}

class AuditController {
  /**
   * Get audit history for a specific entity
   * GET /api/audit/entity/:entityType/:entityId
   */
  getEntityAuditHistory = catchAsync(async (req, res) => {
    const { entityType, entityId } = req.params;
    const { organizationId, userEmail } = req.query;
    
    // Validate required parameters
    if (!entityType || !entityId || !organizationId || !userEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required parameters: entityType, entityId, organizationId, userEmail'
      });
    }

    // Verify user belongs to organization
    const hasAccess = await verifyUserAccess(userEmail, organizationId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied: User not found in organization or inactive'
      });
    }

    // Parse query options
    const options = {
      limit: parseInt(req.query.limit) || 50,
      skip: parseInt(req.query.skip) || 0,
      sortBy: req.query.sortBy || 'timestamp',
      sortOrder: parseInt(req.query.sortOrder) || -1,
      actions: req.query.actions ? req.query.actions.split(',') : null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null
    };

    // Get audit history
    const result = await getEntityAuditHistory(entityType, entityId, organizationId, options);
    
    logger.business('Retrieved entity audit history', {
      action: 'audit_entity_history',
      entityType,
      entityId,
      organizationId,
      userEmail,
      recordCount: result?.auditLogs?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'AUDIT_HISTORY_RETRIEVED',
      data: result
    });
  });

  /**
   * Get organization audit logs with filtering
   * GET /api/audit/organization/:organizationId
   */
  getOrganizationAuditLogs = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { userEmail } = req.query;
    
    // Validate required parameters
    if (!organizationId || !userEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required parameters: organizationId, userEmail'
      });
    }

    // Verify user belongs to organization
    const hasAccess = await verifyUserAccess(userEmail, organizationId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied: User not found in organization or inactive'
      });
    }

    // Parse query options
    const options = {
      limit: parseInt(req.query.limit) || 100,
      skip: parseInt(req.query.skip) || 0,
      sortBy: req.query.sortBy || 'timestamp',
      sortOrder: parseInt(req.query.sortOrder) || -1,
      entityTypes: req.query.entityTypes ? req.query.entityTypes.split(',') : null,
      actions: req.query.actions ? req.query.actions.split(',') : null,
      userEmail: req.query.filterUserEmail || null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null
    };

    // Get audit logs
    const result = await getOrganizationAuditLogs(organizationId, options);
    
    logger.business('Retrieved organization audit logs', {
      action: 'audit_org_logs',
      organizationId,
      userEmail,
      recordCount: result?.auditLogs?.length || 0
    });
    
    res.status(200).json({
      success: true,
      code: 'AUDIT_LOGS_RETRIEVED',
      data: result
    });
  });

  /**
   * Get audit statistics for an organization
   * GET /api/audit/statistics/:organizationId
   */
  getAuditStatistics = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { userEmail } = req.query;
    
    // Validate required parameters
    if (!organizationId || !userEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required parameters: organizationId, userEmail'
      });
    }

    // Verify user belongs to organization
    const hasAccess = await verifyUserAccess(userEmail, organizationId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied: User not found in organization or inactive'
      });
    }

    // Parse query options
    const options = {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null
    };

    // Get audit statistics
    const result = await getAuditStatistics(organizationId, options);
    
    logger.business('Retrieved audit statistics', {
      action: 'audit_statistics',
      organizationId,
      userEmail
    });
    
    res.status(200).json({
      success: true,
      code: 'AUDIT_STATISTICS_RETRIEVED',
      data: result
    });
  });

  /**
   * Create a manual audit log entry
   * POST /api/audit/log
   */
  createAuditLog = catchAsync(async (req, res) => {
    const {
      action,
      entityType,
      entityId,
      userEmail,
      organizationId,
      oldValues,
      newValues,
      reason,
      metadata
    } = req.body;
    
    // Validate required parameters
    if (!action || !entityType || !entityId || !userEmail || !organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: action, entityType, entityId, userEmail, organizationId'
      });
    }

    // Verify user belongs to organization
    const hasAccess = await verifyUserAccess(userEmail, organizationId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied: User not found in organization or inactive'
      });
    }

    // Create audit log
    const auditData = {
      action,
      entityType,
      entityId,
      userEmail,
      organizationId,
      oldValues,
      newValues,
      reason,
      metadata: {
        ...metadata,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    };

    const result = await createAuditLog(auditData);
    
    logger.business('Created audit log entry', {
      action: 'audit_log_create',
      entityType,
      entityId,
      organizationId,
      auditAction: action,
      userEmail
    });
    
    res.status(201).json({
      success: true,
      code: 'AUDIT_LOG_CREATED',
      data: result
    });
  });

  /**
   * Get available audit actions and entity types
   * GET /api/audit/metadata
   */
  getAuditMetadata = catchAsync(async (req, res) => {
    res.status(200).json({
      success: true,
      code: 'AUDIT_METADATA_RETRIEVED',
      data: {
        actions: AUDIT_ACTIONS,
        entityTypes: AUDIT_ENTITIES
      }
    });
  });

  /**
   * Export audit logs for compliance reporting
   * GET /api/audit/export/:organizationId
   */
  exportAuditLogs = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    const { userEmail, format = 'json' } = req.query;
    
    // Validate required parameters
    if (!organizationId || !userEmail) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Missing required parameters: organizationId, userEmail'
      });
    }

    // Verify user belongs to organization
    const hasAccess = await verifyUserAccess(userEmail, organizationId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'Access denied: User not found in organization or inactive'
      });
    }

    // Parse query options for export
    const options = {
      limit: parseInt(req.query.limit) || 10000,
      skip: 0,
      sortBy: 'timestamp',
      sortOrder: 1,
      entityTypes: req.query.entityTypes ? req.query.entityTypes.split(',') : null,
      actions: req.query.actions ? req.query.actions.split(',') : null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null
    };

    // Get audit logs for export
    const result = await getOrganizationAuditLogs(organizationId, options);
    
    // Log the export action
    await createAuditLog({
      action: AUDIT_ACTIONS.EXPORT,
      entityType: AUDIT_ENTITIES.ORGANIZATION,
      entityId: organizationId,
      userEmail,
      organizationId,
      reason: 'Audit logs export',
      metadata: {
        exportFormat: format,
        recordCount: result.auditLogs.length,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    logger.business('Exported audit logs', {
      action: 'audit_export',
      organizationId,
      userEmail,
      format,
      recordCount: result?.auditLogs?.length || 0
    });

    // Set appropriate headers for download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `audit_logs_${organizationId}_${timestamp}.${format}`;
    
    if (format === 'csv') {
      const csvData = AuditController.convertToCSV(result.auditLogs);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).json({
        success: true,
        code: 'AUDIT_LOGS_EXPORTED',
        exportInfo: {
          organizationId,
          exportDate: new Date().toISOString(),
          recordCount: result.auditLogs.length,
          format
        },
        data: result.auditLogs
      });
    }
  });

  /**
   * Helper function to convert audit logs to CSV format
   */
  static convertToCSV(auditLogs) {
    if (!auditLogs || auditLogs.length === 0) {
      return 'No audit logs to export';
    }

    const headers = [
      'Timestamp',
      'Action',
      'Entity Type',
      'Entity ID',
      'User Email',
      'Organization ID',
      'Reason',
      'Old Values',
      'New Values',
      'IP Address',
      'User Agent'
    ];

    const rows = auditLogs.map(log => [
      log.timestamp ? log.timestamp.toISOString() : '',
      log.action || '',
      log.entityType || '',
      log.entityId || '',
      log.userEmail || '',
      log.organizationId || '',
      log.reason || '',
      log.oldValues ? JSON.stringify(log.oldValues) : '',
      log.newValues ? JSON.stringify(log.newValues) : '',
      log.metadata?.ipAddress || '',
      log.metadata?.userAgent || ''
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return csvContent;
  }
}

module.exports = new AuditController();
