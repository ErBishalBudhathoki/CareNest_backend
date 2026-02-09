const mongoose = require('mongoose');

/**
 * JWT Secret Model for Key Rotation
 * 
 * This model stores multiple JWT secrets to support zero-downtime key rotation.
 * - One secret is marked as 'active' (used for signing new tokens)
 * - Previous secrets remain 'valid' for a grace period (verify existing tokens)
 * - Expired/revoked secrets are marked as 'revoked' (no longer accepted)
 */
const jwtSecretSchema = new mongoose.Schema(
  {
    // Unique identifier for this key (kid - Key ID)
    keyId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    
    // The actual secret value (encrypted at rest in production)
    secret: {
      type: String,
      required: true,
      minlength: 32 // Minimum 32 characters for security
    },
    
    // Key status: 'active', 'valid', 'revoked'
    // - active: Current key used for signing new tokens (only one active at a time)
    // - valid: Previous key still accepted for verification during grace period
    // - revoked: No longer accepted for any purpose
    status: {
      type: String,
      enum: ['active', 'valid', 'revoked'],
      required: true,
      default: 'valid',
      index: true
    },
    
    // When this key was created
    createdAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    
    // When this key became active (if it ever did)
    activatedAt: {
      type: Date,
      default: null
    },
    
    // When this key was deactivated (moved from active to valid)
    deactivatedAt: {
      type: Date,
      default: null
    },
    
    // When this key should expire (auto-revoke after this date)
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    
    // When this key was revoked (if manually revoked)
    revokedAt: {
      type: Date,
      default: null
    },
    
    // Reason for revocation (security incident, manual rotation, etc.)
    revocationReason: {
      type: String,
      default: null
    },
    
    // Algorithm used (for future support of different algorithms)
    algorithm: {
      type: String,
      default: 'HS256',
      enum: ['HS256', 'HS384', 'HS512']
    },
    
    // Metadata
    createdBy: {
      type: String,
      default: 'system'
    },
    
    rotationType: {
      type: String,
      enum: ['automatic', 'manual', 'emergency', 'initial'],
      default: 'automatic'
    }
  },
  {
    timestamps: true,
    collection: 'jwt_secrets'
  }
);

// Indexes for performance
jwtSecretSchema.index({ status: 1, expiresAt: 1 });
jwtSecretSchema.index({ createdAt: -1 });

// Static methods

/**
 * Get the current active key for signing new tokens
 */
jwtSecretSchema.statics.getActiveKey = async function() {
  const activeKey = await this.findOne({ 
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).sort({ activatedAt: -1 });
  
  if (!activeKey) {
    throw new Error('No active JWT secret found. Please rotate keys immediately.');
  }
  
  return activeKey;
};

/**
 * Get all valid keys for token verification (active + valid)
 */
jwtSecretSchema.statics.getValidKeys = async function() {
  const validKeys = await this.find({
    status: { $in: ['active', 'valid'] },
    expiresAt: { $gt: new Date() }
  }).sort({ activatedAt: -1 });
  
  return validKeys;
};

/**
 * Create a new key and optionally activate it
 */
jwtSecretSchema.statics.createKey = async function(options = {}) {
  const crypto = require('crypto');
  
  const keyId = options.keyId || `key_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const secret = options.secret || crypto.randomBytes(64).toString('base64');
  const status = options.activate ? 'active' : 'valid';
  
  // Default expiration: 90 days from now
  const expiresAt = options.expiresAt || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  
  const newKey = new this({
    keyId,
    secret,
    status,
    expiresAt,
    activatedAt: options.activate ? new Date() : null,
    algorithm: options.algorithm || 'HS256',
    createdBy: options.createdBy || 'system',
    rotationType: options.rotationType || 'automatic'
  });
  
  await newKey.save();
  
  // If activating, deactivate all other keys
  if (options.activate) {
    await this.updateMany(
      { 
        _id: { $ne: newKey._id },
        status: 'active'
      },
      {
        $set: { 
          status: 'valid',
          deactivatedAt: new Date()
        }
      }
    );
  }
  
  return newKey;
};

/**
 * Rotate keys: create new active key and move old active to valid
 */
jwtSecretSchema.statics.rotateKeys = async function(options = {}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get current active key
    const currentActive = await this.findOne({ status: 'active' }).session(session);
    
    // Create new active key
    const newKey = await this.createKey({
      ...options,
      activate: true
    });
    
    // Move old active key to valid (if exists)
    if (currentActive) {
      currentActive.status = 'valid';
      currentActive.deactivatedAt = new Date();
      await currentActive.save({ session });
    }
    
    // Auto-revoke expired keys
    await this.updateMany(
      {
        expiresAt: { $lt: new Date() },
        status: { $ne: 'revoked' }
      },
      {
        $set: {
          status: 'revoked',
          revokedAt: new Date(),
          revocationReason: 'Expired automatically'
        }
      },
      { session }
    );
    
    await session.commitTransaction();
    
    return {
      newKey,
      previousKey: currentActive,
      message: 'Key rotation completed successfully'
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Revoke a specific key
 */
jwtSecretSchema.statics.revokeKey = async function(keyId, reason = 'Manual revocation') {
  const result = await this.updateOne(
    { keyId },
    {
      $set: {
        status: 'revoked',
        revokedAt: new Date(),
        revocationReason: reason
      }
    }
  );
  
  return result;
};

/**
 * Clean up old revoked keys (keep for audit trail, but remove after retention period)
 */
jwtSecretSchema.statics.cleanupOldKeys = async function(retentionDays = 180) {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  
  const result = await this.deleteMany({
    status: 'revoked',
    revokedAt: { $lt: cutoffDate }
  });
  
  return result;
};

// Instance methods

/**
 * Check if this key is currently usable for verification
 */
jwtSecretSchema.methods.isValid = function() {
  return (
    ['active', 'valid'].includes(this.status) &&
    this.expiresAt > new Date()
  );
};

/**
 * Check if this key is the active signing key
 */
jwtSecretSchema.methods.isActive = function() {
  return this.status === 'active' && this.expiresAt > new Date();
};

/**
 * Activate this key (make it the current signing key)
 */
jwtSecretSchema.methods.activate = async function() {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Deactivate all other active keys
    await this.constructor.updateMany(
      { 
        _id: { $ne: this._id },
        status: 'active'
      },
      {
        $set: { 
          status: 'valid',
          deactivatedAt: new Date()
        }
      },
      { session }
    );
    
    // Activate this key
    this.status = 'active';
    this.activatedAt = new Date();
    await this.save({ session });
    
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const JWTSecret = mongoose.model('JWTSecret', jwtSecretSchema);

module.exports = JWTSecret;
