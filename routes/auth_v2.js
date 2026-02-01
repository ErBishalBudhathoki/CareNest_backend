const express = require('express');
const AuthController = require('../controllers/authController_v2');
const { rateLimitMiddleware, authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * @route POST /api/v2/auth/register
 */
router.post('/register',
    rateLimitMiddleware('register'),
    AuthController.register
);

/**
 * @route POST /api/v2/auth/login
 */
router.post('/login',
    rateLimitMiddleware('login'),
    AuthController.login
);

/**
 * @route POST /api/v2/auth/refresh-token
 */
router.post('/refresh-token',
    rateLimitMiddleware('refresh'),
    AuthController.refreshToken
);

/**
 * @route POST /api/v2/auth/logout
 */
router.post('/logout',
    AuthController.logout
);

/**
 * @route GET /api/v2/auth/me
 * Protected route example
 */
router.get('/me',
    authenticateUser,
    (req, res) => {
        res.json({ success: true, user: req.user });
    }
);

/**
 * @route POST /api/v2/auth/change-password
 */
router.post('/change-password',
    authenticateUser,
    AuthController.changePassword
);

module.exports = router;
