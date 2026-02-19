const express = require('express');
const router = express.Router();
const catchAsync = require('../utils/catchAsync');
const keyRotationService = require('../services/jwtKeyRotationService');
const JWTSecret = require('../models/JWTSecret');
const { AuthMiddleware } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const logger = createLogger('KeyRotationController');

/**
 * Admin API for JWT Key Rotation Management
 * 
 * All endpoints require admin authentication
 */

/**
 * GET /api/admin/jwt-keys/status
 * Get current key rotation status
 */
router.get('/status', 
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const status = await keyRotationService.getRotationStatus();
    
    res.json({
      success: true,
      data: status
    });
  })
);

/**
 * GET /api/admin/jwt-keys
 * List all JWT keys with metadata (secrets are masked)
 */
router.get('/',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const keys = await JWTSecret.find()
      .sort({ createdAt: -1 })
      .select('-secret'); // Don't expose actual secrets
    
    res.json({
      success: true,
      count: keys.length,
      data: keys
    });
  })
);

/**
 * GET /api/admin/jwt-keys/:keyId
 * Get details of a specific key (secret is masked)
 */
router.get('/:keyId',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const key = await JWTSecret.findOne({ keyId: req.params.keyId })
      .select('-secret');
    
    if (!key) {
      return res.status(404).json({
        success: false,
        message: 'Key not found'
      });
    }
    
    res.json({
      success: true,
      data: key
    });
  })
);

/**
 * POST /api/admin/jwt-keys/rotate
 * Manually trigger key rotation
 */
router.post('/rotate',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const { keyLifetimeDays } = req.body;
    
    logger.info('Manual key rotation triggered', {
      userId: req.user.userId,
      email: req.user.email,
      ip: req.ip
    });
    
    const result = await keyRotationService.rotateKeys({
      rotationType: 'manual',
      createdBy: req.user.email,
      keyLifetimeDays: keyLifetimeDays || 90
    });
    
    res.json({
      success: true,
      message: 'Key rotation completed successfully',
      data: {
        newKeyId: result.newKey.keyId,
        previousKeyId: result.previousKey?.keyId,
        expiresAt: result.newKey.expiresAt
      }
    });
  })
);

/**
 * POST /api/admin/jwt-keys/emergency-rotate
 * Emergency key rotation (revokes all existing keys immediately)
 * WARNING: This will invalidate ALL existing tokens
 */
router.post('/emergency-rotate',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['superadmin']), // Only superadmin can do emergency rotation
  catchAsync(async (req, res) => {
    const { reason, keyLifetimeDays } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for emergency rotation'
      });
    }
    
    logger.security('Emergency key rotation triggered', {
      userId: req.user.userId,
      email: req.user.email,
      reason,
      ip: req.ip
    });
    
    const result = await keyRotationService.emergencyRotation(reason, {
      createdBy: req.user.email,
      keyLifetimeDays: keyLifetimeDays || 90
    });
    
    res.json({
      success: true,
      message: result.message,
      warning: 'All previous tokens have been invalidated. Users must re-authenticate.',
      data: {
        newKeyId: result.newKey.keyId,
        revokedKeysCount: result.revokedCount
      }
    });
  })
);

/**
 * POST /api/admin/jwt-keys/:keyId/revoke
 * Revoke a specific key
 */
router.post('/:keyId/revoke',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const { reason } = req.body;
    const { keyId } = req.params;
    
    // Prevent revoking the active key (use emergency rotation instead)
    const key = await JWTSecret.findOne({ keyId });
    if (!key) {
      return res.status(404).json({
        success: false,
        message: 'Key not found'
      });
    }
    
    if (key.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot revoke active key. Use emergency rotation instead.'
      });
    }
    
    logger.security('Key revoked manually', {
      keyId,
      userId: req.user.userId,
      email: req.user.email,
      reason,
      ip: req.ip
    });
    
    await JWTSecret.revokeKey(keyId, reason || `Revoked by ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Key revoked successfully'
    });
  })
);

/**
 * POST /api/admin/jwt-keys/:keyId/activate
 * Activate a specific key (makes it the current signing key)
 */
router.post('/:keyId/activate',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const { keyId } = req.params;
    
    const key = await JWTSecret.findOne({ keyId });
    if (!key) {
      return res.status(404).json({
        success: false,
        message: 'Key not found'
      });
    }
    
    if (key.status === 'revoked') {
      return res.status(400).json({
        success: false,
        message: 'Cannot activate a revoked key'
      });
    }
    
    if (!key.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot activate an expired key'
      });
    }
    
    logger.security('Key activated manually', {
      keyId,
      userId: req.user.userId,
      email: req.user.email,
      ip: req.ip
    });
    
    await key.activate();
    
    // Refresh cache
    await keyRotationService.refreshKeyCache();
    
    res.json({
      success: true,
      message: 'Key activated successfully',
      data: {
        keyId: key.keyId,
        activatedAt: key.activatedAt,
        expiresAt: key.expiresAt
      }
    });
  })
);

/**
 * GET /api/admin/jwt-keys/health
 * Health check for key rotation system
 */
router.get('/health/check',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['admin', 'superadmin']),
  catchAsync(async (req, res) => {
    const health = await keyRotationService.healthCheck();
    
    const statusCode = health.healthy ? 200 : 503;
    
    res.status(statusCode).json({
      success: health.healthy,
      data: health
    });
  })
);

/**
 * DELETE /api/admin/jwt-keys/cleanup
 * Clean up old revoked keys (keeps them for audit trail by default)
 */
router.delete('/cleanup',
  AuthMiddleware.authenticateUser,
  AuthMiddleware.requireRoles(['superadmin']),
  catchAsync(async (req, res) => {
    const { retentionDays } = req.body;
    
    logger.info('Cleanup of old revoked keys triggered', {
      userId: req.user.userId,
      email: req.user.email,
      retentionDays: retentionDays || 180
    });
    
    const result = await JWTSecret.cleanupOldKeys(retentionDays || 180);
    
    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} old revoked keys`,
      data: {
        deletedCount: result.deletedCount
      }
    });
  })
);

module.exports = router;
