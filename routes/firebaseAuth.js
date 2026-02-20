const express = require('express');
const router = express.Router();
const FirebaseAuthController = require('../controllers/firebaseAuthController');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
const { requireAppCheck } = require('../middleware/appCheck');

function isIOSPlatform(req) {
  const platform = req.header('X-Platform');
  return platform && platform.toLowerCase() === 'ios';
}

function optionalAppCheck(req, res, next) {
  if (isIOSPlatform(req)) {
    return next();
  }
  return requireAppCheck(req, res, next);
}

/**
 * @route POST /api/firebase-auth/sync
 * @desc Sync Firebase user with MongoDB
 * @access Public (but requires valid Firebase ID token)
 */
router.post('/sync',
  optionalAppCheck,
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const { uid, email, name, picture } = req.firebaseUser;
      
      const firstName = name?.split(' ')[0] || '';
      const lastName = name?.split(' ').slice(1).join(' ') || '';

      req.body = {
        ...req.body,
        firebaseUid: uid,
        email,
        firstName: req.body.firstName || firstName,
        lastName: req.body.lastName || lastName,
        photoURL: req.body.photoURL || picture
      };

      return await FirebaseAuthController.syncUser(req, res);
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Sync failed',
        error: error.message
      });
    }
  }
);

/**
 * @route GET /api/firebase-auth/user/:firebaseUid
 * @desc Get user data by Firebase UID
 * @access Private
 */
router.get('/user/:firebaseUid',
  optionalAppCheck,
  verifyFirebaseToken,
  FirebaseAuthController.getUserByFirebaseUid
);

/**
 * @route PUT /api/firebase-auth/profile/:firebaseUid
 * @desc Update user profile
 * @access Private
 */
router.put('/profile/:firebaseUid',
  optionalAppCheck,
  verifyFirebaseToken,
  FirebaseAuthController.updateProfile
);

/**
 * @route DELETE /api/firebase-auth/account/:firebaseUid
 * @desc Delete user account
 * @access Private
 */
router.delete('/account/:firebaseUid',
  optionalAppCheck,
  verifyFirebaseToken,
  FirebaseAuthController.deleteAccount
);

/**
 * @route POST /api/firebase-auth/verify-email
 * @desc Mark email as verified in MongoDB
 * @access Private
 */
router.post('/verify-email',
  optionalAppCheck,
  verifyFirebaseToken,
  FirebaseAuthController.verifyEmail
);

module.exports = router;

