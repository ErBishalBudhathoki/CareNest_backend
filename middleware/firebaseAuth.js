const { admin } = require('../firebase-admin-config');
const { createLogger } = require('../utils/logger');
const User = require('../models/User');

const logger = createLogger('FirebaseAuthMiddleware');

/**
 * Middleware to verify Firebase ID tokens
 * Extracts user information and attaches to req.user
 * Also syncs with MongoDB database
 */
async function verifyFirebaseToken(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Missing or invalid authorization header',
        errorCode: 'MISSING_AUTH_TOKEN'
      });
    }

    const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    logger.info('Firebase token verified', {
      uid: decodedToken.uid,
      email: decodedToken.email
    });

    // Attach Firebase user info to request
    req.firebaseUser = decodedToken;

    // Fetch or sync MongoDB user
    let mongoUser = await User.findOne({ firebaseUid: decodedToken.uid });

    if (!mongoUser) {
      // Try to find by email (for migration scenarios)
      mongoUser = await User.findOne({ email: decodedToken.email });
      
      if (mongoUser) {
        // Link existing user to Firebase UID
        mongoUser.firebaseUid = decodedToken.uid;
        mongoUser.firebaseSyncedAt = new Date();
        await mongoUser.save();
        logger.info('Linked existing user to Firebase UID', {
          email: decodedToken.email,
          firebaseUid: decodedToken.uid
        });
      } else {
        // Create new MongoDB user from Firebase user
        mongoUser = await User.create({
          firebaseUid: decodedToken.uid,
          email: decodedToken.email,
          firstName: decodedToken.name?.split(' ')[0] || '',
          lastName: decodedToken.name?.split(' ').slice(1).join(' ') || '',
          emailVerified: decodedToken.email_verified || false,
          firebaseSyncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        });
        logger.info('Created new MongoDB user from Firebase', {
          email: decodedToken.email,
          firebaseUid: decodedToken.uid
        });
      }
    }

    // Update last login time
    mongoUser.lastLoginAt = new Date();
    await mongoUser.save();

    // Attach MongoDB user to request
    req.user = mongoUser;

    next();
  } catch (error) {
    logger.error('Firebase token verification failed', {
      error: error.message,
      code: error.code
    });

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please sign in again.',
        errorCode: 'TOKEN_EXPIRED'
      });
    }

    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format',
        errorCode: 'INVALID_TOKEN_FORMAT'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token',
      errorCode: 'INVALID_AUTH_TOKEN'
    });
  }
}

/**
 * Optional Firebase auth middleware
 * Verifies token if present, but doesn't require it
 */
async function optionalFirebaseAuth(req, res, next) {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // No token, continue without auth
    }

    const idToken = authHeader.substring(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    req.firebaseUser = decodedToken;

    // Try to fetch MongoDB user
    const mongoUser = await User.findOne({ firebaseUid: decodedToken.uid });
    if (mongoUser) {
      req.user = mongoUser;
    }

    next();
  } catch (error) {
    // Log error but continue without auth
    logger.warn('Optional Firebase auth failed', {
      error: error.message
    });
    next();
  }
}

/**
 * Check if Firebase Auth is enabled
 */
function isFirebaseAuthEnabled() {
  return process.env.FIREBASE_AUTH_ENABLED !== 'false';
}

module.exports = {
  verifyFirebaseToken,
  optionalFirebaseAuth,
  isFirebaseAuthEnabled
};

