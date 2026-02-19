const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { upload } = require('../config/storage');
const auth = require('../middleware/auth');

// Upload logo route
// Uses existing logo-upload feature logic
// POST /upload/logo
router.post('/logo', auth, upload.single('logo'), uploadController.uploadLogo);

module.exports = router;
