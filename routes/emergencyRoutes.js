const express = require('express');
const router = express.Router();
const EmergencyController = require('../controllers/emergencyController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/broadcast', EmergencyController.broadcast);
router.put('/broadcast/:broadcastId/acknowledge', EmergencyController.acknowledge);

module.exports = router;
