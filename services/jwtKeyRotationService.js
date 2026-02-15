const JWTSecret = require('../models/JWTSecret');
const crypto = require('crypto');

/**
 * JWT Key Rotation Service
 * 
 * Handles automatic and manual JWT secret rotation with zero-downtime support.
 * Integrates with existing authentication middleware and controllers.
 */
class JWTKeyRotationService {
  constructor() {
    this.initialized = false;
    this.rotationInterval = null;
    this.cleanupInterval = null;
    this.rotationIntervalDays = null;
    this.rotationInProgress = false;
    this.activeKey = null;
    this.validKeys = [];
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
    this.lastCacheUpdate = 0;
  }

  /**
   * Initialize the key rotation service
   * - Ensures at least one active key exists
   * - Starts automatic rotation if configured
   */
  async initialize(options = {}) {
    try {
      console.log('[JWT Key Rotation] Initializing service...');
      
      // Check if we have any keys in the database
      const keyCount = await JWTSecret.countDocuments();
      
      if (keyCount === 0) {
        console.log('[JWT Key Rotation] No keys found. Creating initial key...');
        await this.createInitialKey(options);
      }

      // Ensure there is an active and unexpired key.
      await this.ensureUsableActiveKey(options);
      
      // Load keys into cache
      await this.refreshKeyCache({ allowSelfHeal: true, initOptions: options });
      
      this.initialized = true;
      console.log('[JWT Key Rotation] Service initialized successfully');
      
      return { success: true, message: 'JWT Key Rotation Service initialized' };
    } catch (error) {
      console.error('[JWT Key Rotation] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create the initial JWT secret key
   * Uses JWT_SECRET from .env if available, otherwise generates a new one
   */
  async createInitialKey(options = {}) {
    const envSecret = process.env.JWT_SECRET;
    let secret;
    let keyId;
    
    if (envSecret && envSecret.length >= 32 && !this.isWeakSecret(envSecret)) {
      // Use existing JWT_SECRET from environment
      secret = envSecret;
      keyId = `key_initial_env_${Date.now()}`;
      console.log('[JWT Key Rotation] Using JWT_SECRET from environment as initial key');
    } else {
      // Generate a new strong secret
      secret = crypto.randomBytes(64).toString('base64');
      keyId = `key_initial_${Date.now()}`;
      console.log('[JWT Key Rotation] Generated new strong secret as initial key');
      
      if (envSecret) {
        console.warn('[JWT Key Rotation] WARNING: JWT_SECRET in .env is weak or too short. Using generated secret instead.');
      }
    }
    
    const newKey = await JWTSecret.createKey({
      keyId,
      secret,
      activate: true,
      expiresAt: new Date(Date.now() + (options.keyLifetimeDays || 90) * 24 * 60 * 60 * 1000),
      rotationType: 'initial',
      createdBy: 'system'
    });
    
    console.log(`[JWT Key Rotation] Created initial key: ${newKey.keyId}`);
    return newKey;
  }

  /**
   * Ensure there is one active and unexpired key.
   * Handles the case where an "active" key exists but is already expired.
   */
  async ensureUsableActiveKey(options = {}) {
    const now = new Date();

    // Revoke expired active keys so they do not block self-healing.
    const revokeResult = await JWTSecret.updateMany(
      {
        status: 'active',
        expiresAt: { $lte: now }
      },
      {
        $set: {
          status: 'revoked',
          revokedAt: now,
          revocationReason: 'Expired active key auto-revoked during initialization'
        }
      }
    );

    const revokedCount = revokeResult.modifiedCount || revokeResult.nModified || 0;
    if (revokedCount > 0) {
      console.warn(`[JWT Key Rotation] Revoked ${revokedCount} expired active key(s)`);
    }

    // Check for currently usable active key.
    const activeKey = await JWTSecret.findOne({
      status: 'active',
      expiresAt: { $gt: now }
    }).sort({ activatedAt: -1, createdAt: -1 });

    if (activeKey) {
      return activeKey;
    }

    // Promote most recent valid key if available.
    const mostRecentValid = await JWTSecret.findOne({
      status: 'valid',
      expiresAt: { $gt: now }
    }).sort({ createdAt: -1 });

    if (mostRecentValid) {
      await mostRecentValid.activate();
      console.log(`[JWT Key Rotation] Activated key: ${mostRecentValid.keyId}`);
      return mostRecentValid;
    }

    // Last resort: create a fresh initial key.
    console.log('[JWT Key Rotation] No usable keys found. Creating new key...');
    return this.createInitialKey(options);
  }

  /**
   * Check if a secret is considered weak
   */
  isWeakSecret(secret) {
    const weakSecrets = [
      'secret',
      'password',
      'test',
      'your-jwt-secret-key-here',
      '123456',
      'admin',
      'default'
    ];
    
    return weakSecrets.some(weak => secret.toLowerCase().includes(weak));
  }

  /**
   * Refresh the key cache from database
   */
  async refreshKeyCache(options = {}) {
    const { allowSelfHeal = false, initOptions = {} } = options;
    try {
      this.activeKey = await JWTSecret.getActiveKey();
      this.validKeys = await JWTSecret.getValidKeys();
      this.lastCacheUpdate = Date.now();
      
      console.log(`[JWT Key Rotation] Cache refreshed. Active key: ${this.activeKey.keyId}, Valid keys: ${this.validKeys.length}`);
    } catch (error) {
      if (allowSelfHeal && error.message && error.message.includes('No active JWT secret found')) {
        console.warn('[JWT Key Rotation] No active key in cache refresh; attempting self-heal...');
        await this.ensureUsableActiveKey(initOptions);
        this.activeKey = await JWTSecret.getActiveKey();
        this.validKeys = await JWTSecret.getValidKeys();
        this.lastCacheUpdate = Date.now();
        console.log(`[JWT Key Rotation] Cache refreshed after self-heal. Active key: ${this.activeKey.keyId}, Valid keys: ${this.validKeys.length}`);
        return;
      }

      console.error('[JWT Key Rotation] Failed to refresh key cache:', error);
      throw error;
    }
  }

  /**
   * Get the current active key for signing tokens
   * Uses cache to avoid database hits on every token generation
   */
  async getActiveKey() {
    // Refresh cache if expired or not initialized
    if (!this.initialized || Date.now() - this.lastCacheUpdate > this.cacheExpiry) {
      await this.refreshKeyCache();
    }
    
    if (!this.activeKey || !this.activeKey.isActive()) {
      await this.refreshKeyCache();
    }
    
    return this.activeKey;
  }

  /**
   * Get all valid keys for token verification
   * Uses cache to avoid database hits on every token verification
   */
  async getValidKeys() {
    // Refresh cache if expired or not initialized
    if (!this.initialized || Date.now() - this.lastCacheUpdate > this.cacheExpiry) {
      await this.refreshKeyCache();
    }
    
    return this.validKeys;
  }

  /**
   * Get a specific key by keyId (from token header)
   */
  async getKeyById(keyId) {
    const validKeys = await this.getValidKeys();
    return validKeys.find(key => key.keyId === keyId);
  }

  /**
   * Perform key rotation
   * Creates a new active key and moves the old one to valid status
   */
  async rotateKeys(options = {}) {
    if (this.rotationInProgress) {
      const conflictError = new Error('JWT key rotation already in progress');
      conflictError.statusCode = 409;
      conflictError.code = 'ROTATION_IN_PROGRESS';
      throw conflictError;
    }

    this.rotationInProgress = true;
    try {
      console.log('[JWT Key Rotation] Starting key rotation...');
      
      const rotationType = options.rotationType || 'automatic';
      const createdBy = options.createdBy || 'system';
      const keyLifetimeDays = options.keyLifetimeDays || 90;

      const maxRetries = 3;
      let result;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          result = await JWTSecret.rotateKeys({
            expiresAt: new Date(Date.now() + keyLifetimeDays * 24 * 60 * 60 * 1000),
            rotationType,
            createdBy
          });
          break;
        } catch (error) {
          lastError = error;
          if (!this._isWriteConflictError(error) || attempt === maxRetries) {
            throw error;
          }

          const delayMs = attempt * 250;
          console.warn(
            `[JWT Key Rotation] WriteConflict during rotation, retrying (${attempt}/${maxRetries}) in ${delayMs}ms`
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      if (!result) {
        throw lastError || new Error('JWT key rotation failed: no result');
      }
      
      // Refresh cache with new keys
      await this.refreshKeyCache();
      
      console.log(`[JWT Key Rotation] Rotation completed. New key: ${result.newKey.keyId}`);
      
      // Emit event for monitoring/logging
      this.emitRotationEvent({
        type: 'rotation_completed',
        newKeyId: result.newKey.keyId,
        previousKeyId: result.previousKey?.keyId,
        rotationType,
        timestamp: new Date()
      });
      
      return result;
    } catch (error) {
      console.error('[JWT Key Rotation] Rotation failed:', error);
      
      this.emitRotationEvent({
        type: 'rotation_failed',
        error: error.message,
        timestamp: new Date()
      });
      
      throw error;
    } finally {
      this.rotationInProgress = false;
    }
  }

  /**
   * Emergency key rotation (immediate revocation of all old keys)
   * Use this when keys are compromised
   */
  async emergencyRotation(reason, options = {}) {
    try {
      console.log(`[JWT Key Rotation] EMERGENCY ROTATION: ${reason}`);
      
      // Get all current keys
      const allKeys = await JWTSecret.find({ status: { $ne: 'revoked' } });
      
      // Revoke all existing keys
      for (const key of allKeys) {
        await JWTSecret.revokeKey(key.keyId, `Emergency rotation: ${reason}`);
      }
      
      // Create new active key
      const newKey = await JWTSecret.createKey({
        activate: true,
        expiresAt: new Date(Date.now() + (options.keyLifetimeDays || 90) * 24 * 60 * 60 * 1000),
        rotationType: 'emergency',
        createdBy: options.createdBy || 'system'
      });
      
      // Refresh cache
      await this.refreshKeyCache();
      
      console.log(`[JWT Key Rotation] Emergency rotation completed. New key: ${newKey.keyId}`);
      console.warn('[JWT Key Rotation] WARNING: All previous tokens are now invalid. Users must re-authenticate.');
      
      this.emitRotationEvent({
        type: 'emergency_rotation',
        reason,
        newKeyId: newKey.keyId,
        revokedCount: allKeys.length,
        timestamp: new Date()
      });
      
      return {
        newKey,
        revokedCount: allKeys.length,
        message: 'Emergency rotation completed. All previous tokens invalidated.'
      };
    } catch (error) {
      console.error('[JWT Key Rotation] Emergency rotation failed:', error);
      throw error;
    }
  }

  /**
   * Start automatic key rotation on a schedule
   */
  async startAutomaticRotation(intervalDays = 30) {
    if (this.rotationInterval) {
      console.log('[JWT Key Rotation] Automatic rotation already running');
      return {
        started: false,
        intervalDays: this.rotationIntervalDays
      };
    }

    const fallbackIntervalDays = 30;
    const minIntervalDaysRaw = process.env.JWT_ROTATION_MIN_INTERVAL_DAYS || '1';
    const minIntervalDays = Number(minIntervalDaysRaw);
    const effectiveMinIntervalDays = Number.isFinite(minIntervalDays) && minIntervalDays > 0
      ? minIntervalDays
      : 1;

    let parsedIntervalDays = Number(intervalDays);
    if (!Number.isFinite(parsedIntervalDays) || parsedIntervalDays <= 0) {
      console.warn(
        `[JWT Key Rotation] Invalid rotation interval "${intervalDays}". Falling back to ${fallbackIntervalDays} days.`
      );
      parsedIntervalDays = fallbackIntervalDays;
    }

    if (parsedIntervalDays < effectiveMinIntervalDays) {
      console.warn(
        `[JWT Key Rotation] Rotation interval ${parsedIntervalDays} day(s) is below minimum ${effectiveMinIntervalDays} day(s). Using minimum.`
      );
      parsedIntervalDays = effectiveMinIntervalDays;
    }

    const intervalMs = Math.round(parsedIntervalDays * 24 * 60 * 60 * 1000);
    this.rotationIntervalDays = parsedIntervalDays;

    console.log(`[JWT Key Rotation] Starting automatic rotation every ${parsedIntervalDays} days`);

    this.rotationInterval = setInterval(async () => {
      try {
        console.log('[JWT Key Rotation] Automatic rotation triggered');
        await this.rotateKeys({ rotationType: 'automatic' });
      } catch (error) {
        if (error.code === 'ROTATION_IN_PROGRESS') {
          console.warn('[JWT Key Rotation] Automatic rotation skipped (rotation already in progress)');
          return;
        }
        console.error('[JWT Key Rotation] Automatic rotation failed:', error);
      }
    }, intervalMs);

    if (typeof this.rotationInterval.unref === 'function') {
      this.rotationInterval.unref();
    }

    // Also schedule cleanup of old revoked keys
    this.cleanupInterval = setInterval(async () => {
      try {
        const result = await JWTSecret.cleanupOldKeys(180); // Keep for 6 months
        if (result.deletedCount > 0) {
          console.log(`[JWT Key Rotation] Cleaned up ${result.deletedCount} old revoked keys`);
        }
      } catch (error) {
        console.error('[JWT Key Rotation] Cleanup failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // Run daily

    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }

    return {
      started: true,
      intervalDays: parsedIntervalDays
    };
  }

  /**
   * Stop automatic key rotation
   */
  stopAutomaticRotation() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
      this.rotationInterval = null;
      console.log('[JWT Key Rotation] Automatic rotation stopped');
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.rotationIntervalDays = null;
  }

  _isWriteConflictError(error) {
    if (!error) return false;
    if (error.code === 112) return true;
    if (typeof error.message === 'string' && error.message.includes('WriteConflict')) {
      return true;
    }
    return false;
  }

  /**
   * Get rotation status and statistics
   */
  async getRotationStatus() {
    const activeKey = await JWTSecret.findOne({
      status: 'active',
      expiresAt: { $gt: new Date() }
    });
    const validKeys = await JWTSecret.find({ status: 'valid' });
    const revokedKeys = await JWTSecret.find({ status: 'revoked' });
    
    const now = new Date();
    const daysUntilExpiry = activeKey 
      ? Math.ceil((activeKey.expiresAt - now) / (24 * 60 * 60 * 1000))
      : null;
    
    return {
      activeKey: activeKey ? {
        keyId: activeKey.keyId,
        activatedAt: activeKey.activatedAt,
        expiresAt: activeKey.expiresAt,
        daysUntilExpiry,
        algorithm: activeKey.algorithm
      } : null,
      validKeysCount: validKeys.length,
      revokedKeysCount: revokedKeys.length,
      automaticRotationEnabled: !!this.rotationInterval,
      cacheLastUpdated: new Date(this.lastCacheUpdate),
      initialized: this.initialized
    };
  }

  /**
   * Emit rotation events for monitoring/logging
   * Override this method to integrate with your monitoring system
   */
  emitRotationEvent(event) {
    // Log to console by default
    console.log('[JWT Key Rotation Event]', JSON.stringify(event, null, 2));
    
    // TODO: Integrate with monitoring system (e.g., CloudWatch, DataDog, etc.)
    // You can also emit to event bus, send notifications, etc.
  }

  /**
   * Validate key health and check for issues
   */
  async healthCheck() {
    const issues = [];
    const warnings = [];
    
    try {
      // Check for active key
      const activeKey = await JWTSecret.findOne({
        status: 'active',
        expiresAt: { $gt: new Date() }
      });
      if (!activeKey) {
        issues.push('No active key found');
      } else {
        // Check expiry
        const now = new Date();
        const daysUntilExpiry = Math.ceil((activeKey.expiresAt - now) / (24 * 60 * 60 * 1000));
        
        if (daysUntilExpiry < 0) {
          issues.push(`Active key expired ${Math.abs(daysUntilExpiry)} days ago`);
        } else if (daysUntilExpiry < 7) {
          warnings.push(`Active key expires in ${daysUntilExpiry} days`);
        }
      }
      
      // Check for valid keys
      const validKeys = await JWTSecret.find({ 
        status: { $in: ['active', 'valid'] },
        expiresAt: { $gt: new Date() }
      });
      
      if (validKeys.length === 0) {
        issues.push('No valid keys available');
      }
      
      // Check cache freshness
      const cacheAge = Date.now() - this.lastCacheUpdate;
      if (cacheAge > this.cacheExpiry * 2) {
        warnings.push('Key cache is stale');
      }
      
      const healthy = issues.length === 0;
      
      return {
        healthy,
        issues,
        warnings,
        status: healthy ? 'OK' : 'CRITICAL',
        timestamp: new Date()
      };
    } catch (error) {
      return {
        healthy: false,
        issues: [`Health check failed: ${error.message}`],
        warnings: [],
        status: 'ERROR',
        timestamp: new Date()
      };
    }
  }
}

// Create singleton instance
const keyRotationService = new JWTKeyRotationService();

module.exports = keyRotationService;
