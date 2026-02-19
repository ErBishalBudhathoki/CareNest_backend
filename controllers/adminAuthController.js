
const redis = require('../config/redis');
const { createLogger } = require('../utils/logger'); // Import createLogger instead of default export
const SecureErrorHandler = require('../utils/errorHandler');

const logger = createLogger('AdminAuthController'); // Create logger instance

/**
 * Admin Auth Controller
 * Handles administrative authentication tasks
 */
class AdminAuthController {
  /**
   * Reset rate limits for a specific user (email)
   * Clears all auth-related rate limit keys for the given email
   */
  static async resetRateLimits(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json(
          SecureErrorHandler.createErrorResponse(
            'Email is required',
            400,
            'MISSING_FIELDS'
          )
        );
      }

      // List of rate limit types to clear
      const types = ['login', 'register', 'verify', 'forgot', 'reset', 'resend'];
      let clearedCount = 0;

      for (const type of types) {
        // Construct the key used by rate-limit-redis
        // Format: prefix + key (email)
        // Note: rate-limit-redis might hash the key or use it directly depending on config.
        // With default config, it uses the key as is.
        const key = `rl:${type}:${email}`;
        
        const result = await redis.del(key);
        if (result > 0) {
          clearedCount++;
          logger.info(`Cleared rate limit for ${email}`, { type });
        }
      }

      logger.security('Admin reset rate limits', {
        adminId: req.user.userId,
        targetEmail: email,
        clearedCount
      });

      return res.status(200).json(
        SecureErrorHandler.createSuccessResponse(
          { clearedCount },
          `Rate limits reset successfully. Cleared ${clearedCount} active limits.`
        )
      );

    } catch (error) {
      console.error('Reset rate limits error', error); // Fallback logging
      if (logger && logger.error) {
        logger.error('Reset rate limits error', {
          error: error.message,
          adminId: req.user?.userId
        });
      }
      return SecureErrorHandler.handleError(error, res);
    }
  }
}

module.exports = AdminAuthController;
