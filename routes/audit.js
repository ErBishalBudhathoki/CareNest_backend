const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const {
  getEntityAuditHistory,
  getOrganizationAuditLogs,
  getAuditStatistics,
  createManualAuditLog,
  getAuditMetadata,
  exportAuditLogs
} = require('../services/auditService');
const logger = require('../config/logger');

// Rate limiting configurations
const auditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many audit requests.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many requests.' }
});

// Validation rules
const entityAuditValidation = [
  param('entityType').trim().notEmpty().withMessage('Entity type is required'),
  param('entityId').isMongoId().withMessage('Valid entity ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
];

const orgAuditValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('action').optional().trim().isLength({ max: 100 }),
  query('entityType').optional().trim().isLength({ max: 100 }),
  query('userId').optional().isMongoId().withMessage('Invalid user ID'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

const statsValidation = [
  param('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
];

const manualLogValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('userId').isMongoId().withMessage('Valid user ID is required'),
  body('action').trim().notEmpty().withMessage('Action is required'),
  body('entityType').trim().notEmpty().withMessage('Entity type is required'),
  body('entityId').isMongoId().withMessage('Valid entity ID is required'),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('metadata').optional().isObject()
];

const exportValidation = [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('format').isIn(['csv', 'json', 'xlsx']).withMessage('Format must be csv, json, or xlsx'),
  body('filters').optional().isObject(),
  body('startDate').optional().isISO8601().withMessage('Invalid start date'),
  body('endDate').optional().isISO8601().withMessage('Invalid end date')
];

// Apply authentication to all routes
router.use(authenticateUser);

// Get audit history for a specific entity
router.get('/api/audit/entity/:entityType/:entityId', auditLimiter, entityAuditValidation, handleValidationErrors, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const result = await getEntityAuditHistory(entityType, entityId, {
      page: parseInt(page),
      limit: parseInt(limit)
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Audit logs fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      entityType: req.query.entityType,
      entityId: req.query.entityId
    });
    res.status(500).json({ error: 'Failed to fetch entity audit history' });
  }
});

// Get audit logs for an organization
router.get('/api/audit/organization/:organizationId', auditLimiter, orgAuditValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const {
      page = 1,
      limit = 50,
      action,
      entityType,
      userId,
      startDate,
      endDate
    } = req.query;
    
    const result = await getOrganizationAuditLogs(organizationId, {
      page: parseInt(page),
      limit: parseInt(limit),
      action,
      entityType,
      userId,
      startDate,
      endDate
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Audit logs fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      entityType: req.query.entityType,
      entityId: req.query.entityId
    });
    res.status(500).json({ error: 'Failed to fetch organization audit logs' });
  }
});

// Get audit statistics
router.get('/api/audit/stats/:organizationId', auditLimiter, statsValidation, handleValidationErrors, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { startDate, endDate } = req.query;
    
    const stats = await getAuditStatistics(organizationId, {
      startDate,
      endDate
    });
    
    res.json(stats);
  } catch (error) {
    logger.error('Audit logs fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      entityType: req.query.entityType,
      entityId: req.query.entityId
    });
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

// Create a manual audit log entry
router.post('/api/audit/manual', strictLimiter, requireRoles(['admin']), manualLogValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      organizationId,
      userId,
      action,
      entityType,
      entityId,
      description,
      metadata
    } = req.body;
    
    const result = await createManualAuditLog({
      organizationId,
      userId,
      action,
      entityType,
      entityId,
      description,
      metadata
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Audit logs fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      entityType: req.query.entityType,
      entityId: req.query.entityId
    });
    res.status(500).json({ error: 'Failed to create manual audit log' });
  }
});

// Get audit metadata (actions, entity types, etc.)
router.get('/api/audit/metadata', auditLimiter, async (req, res) => {
  try {
    const metadata = await getAuditMetadata();
    res.json(metadata);
  } catch (error) {
    logger.error('Audit logs fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      entityType: req.query.entityType,
      entityId: req.query.entityId
    });
    res.status(500).json({ error: 'Failed to fetch audit metadata' });
  }
});

// Export audit logs
router.post('/api/audit/export', strictLimiter, requireRoles(['admin']), exportValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      organizationId,
      format = 'csv',
      filters = {},
      startDate,
      endDate
    } = req.body;
    
    const result = await exportAuditLogs(organizationId, {
      format,
      filters,
      startDate,
      endDate
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Audit logs fetch failed', {
      error: error.message,
      stack: error.stack,
      organizationId: req.query.organizationId,
      entityType: req.query.entityType,
      entityId: req.query.entityId
    });
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

module.exports = router;
