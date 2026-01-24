const express = require('express');
const router = express.Router();
const VoiceController = require('../controllers/voiceController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/commands', VoiceController.processCommand);

module.exports = router;
