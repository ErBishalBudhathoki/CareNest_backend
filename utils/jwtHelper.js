const jwt = require('jsonwebtoken');
const keyRotationService = require('../services/jwtKeyRotationService');
const { createLogger } = require('./logger');

const logger = createLogger('JWTHelper');

/**
 * JWT Helper Utility
 * 
 * Centralized JWT token generation and verification with key rotation support.
 * Use these helpers throughout the application instead of calling jwt.sign/verify directly.
 */
class JWTHelper {
  /**
   * Generate a JWT token using the current active key from key rotation service
   * 
   * @param {Object} payload - Token payload (userId, email, roles, etc.)
   * @param {Object} options - JWT options (expiresIn, issuer, audience)
   * @returns {Promise<string>} - JWT token
   */
  static async generateToken(payload, options = {}) {
    try {
      // Get the current active key
      const activeKey = await keyRotationService.getActiveKey();
      
      const jwtOptions = {
        expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '24h',
        issuer: options.issuer || 'invoice-app',
        audience: options.audience || 'invoice-app-users',
        keyid: activeKey.keyId // Include key ID in JWT header
      };
      
      const token = jwt.sign(payload, activeKey.secret, jwtOptions);
      
      logger.debug('Token generated successfully', {
        keyId: activeKey.keyId,
        userId: payload.userId,
        expiresIn: jwtOptions.expiresIn
      });
      
      return token;
    } catch (error) {
      // Fallback to environment variable if key rotation service fails
      logger.warn('Key rotation service unavailable, using JWT_SECRET fallback', {
        error: error.message
      });
      
      const jwtOptions = {
        expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '24h',
        issuer: options.issuer || 'invoice-app',
        audience: options.audience || 'invoice-app-users'
      };
      
      const token = jwt.sign(payload, process.env.JWT_SECRET, jwtOptions);
      
      return token;
    }
  }

  /**
   * Verify a JWT token using all valid keys (supports key rotation)
   * 
   * @param {string} token - JWT token to verify
   * @param {Object} options - Verification options (issuer, audience)
   * @returns {Promise<Object>} - Decoded token payload
   * @throws {Error} - If token is invalid or expired
   */
  static async verifyToken(token, options = {}) {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token format');
    }
    
    const jwtOptions = {
      issuer: options.issuer || 'invoice-app',
      audience: options.audience || 'invoice-app-users'
    };
    
    let decoded;
    let lastError;
    
    try {
      // Get all valid keys (active + previous valid keys)
      const validKeys = await keyRotationService.getValidKeys();
      
      if (!validKeys || validKeys.length === 0) {
        throw new Error('No valid JWT keys available');
      }
      
      // Try to verify with each valid key (most recent first)
      for (const key of validKeys) {
        try {
          decoded = jwt.verify(token, key.secret, jwtOptions);
          
          // Add key metadata to decoded token
          decoded._keyId = key.keyId;
          decoded._verifiedAt = new Date();
          
          logger.debug('Token verified successfully', {
            keyId: key.keyId,
            userId: decoded.userId
          });
          
          return decoded;
        } catch (err) {
          // Store the error but continue trying other keys
          lastError = err;
          continue;
        }
      }
      
      // If no key worked, throw the last error
      throw lastError || new Error('Token verification failed');
    } catch (error) {
      // If key rotation service fails, fallback to environment variable
      if (error.message === 'No valid JWT keys available' || !decoded) {
        logger.warn('Key rotation service unavailable, using JWT_SECRET fallback', {
          error: error.message
        });
        
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET, jwtOptions);
          decoded._keyId = 'env_fallback';
          decoded._verifiedAt = new Date();
          
          return decoded;
        } catch (fallbackError) {
          // Re-throw the original error if fallback also fails
          throw fallbackError;
        }
      }
      
      throw error;
    }
  }

  /**
   * Decode a JWT token without verification (use carefully!)
   * 
   * @param {string} token - JWT token to decode
   * @returns {Object|null} - Decoded token payload or null if invalid
   */
  static decodeToken(token) {
    try {
      return jwt.decode(token, { complete: true });
    } catch (error) {
      logger.warn('Failed to decode token', { error: error.message });
      return null;
    }
  }

  /**
   * Extract key ID from JWT token header
   * 
   * @param {string} token - JWT token
   * @returns {string|null} - Key ID or null if not found
   */
  static getKeyIdFromToken(token) {
    try {
      const decoded = jwt.decode(token, { complete: true });
      return decoded?.header?.kid || decoded?.header?.keyid || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a token is expired without verifying signature
   * 
   * @param {string} token - JWT token
   * @returns {boolean} - True if expired
   */
  static isTokenExpired(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) {
        return true;
      }
      
      return decoded.exp < Math.floor(Date.now() / 1000);
    } catch (error) {
      return true;
    }
  }

  /**
   * Get token expiration date
   * 
   * @param {string} token - JWT token
   * @returns {Date|null} - Expiration date or null
   */
  static getTokenExpiration(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) {
        return null;
      }
      
      return new Date(decoded.exp * 1000);
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate a refresh token (long-lived token for token refresh)
   * 
   * @param {Object} payload - Token payload
   * @returns {Promise<string>} - Refresh token
   */
  static async generateRefreshToken(payload) {
    return this.generateToken(payload, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
    });
  }

  /**
   * Verify refresh token
   * 
   * @param {string} token - Refresh token
   * @returns {Promise<Object>} - Decoded token payload
   */
  static async verifyRefreshToken(token) {
    return this.verifyToken(token);
  }
}

module.exports = JWTHelper;
