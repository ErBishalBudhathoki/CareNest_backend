const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { authenticateUser } = require('../middleware/auth');
const { downloadFile, downloadPublicLogo } = require('../controllers/fileController');

// Authenticated proxy for private files (receipts, photos, certifications).
router.get('/download', authenticateUser, downloadFile);

// Public org logos only — the handler itself rejects any key outside
// logos/, so this cannot be abused as an open proxy. Rate-limited since
// it is reachable without credentials.
const publicLogoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many logo requests, please try again later',
  },
});
router.get('/public', publicLogoLimiter, downloadPublicLogo);

module.exports = router;
