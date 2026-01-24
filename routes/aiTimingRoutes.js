const express = require('express');
const router = express.Router();
const AiTimingController = require('../controllers/aiTimingController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/optimal-time', AiTimingController.getOptimalTime);
router.post('/feedback', AiTimingController.recordFeedback);

module.exports = router;
