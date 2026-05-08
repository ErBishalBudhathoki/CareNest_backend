const express = require('express');
const router = express.Router();
const communicationHubController = require('../controllers/communicationHubController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/send', communicationHubController.sendMessage);
router.get('/conversations/:userId', communicationHubController.getConversations);
router.get('/messages/:conversationId', communicationHubController.getMessages);
router.post('/broadcast', communicationHubController.broadcastMessage);
router.post('/broadcasts/active', communicationHubController.getActiveBroadcasts);
router.post('/broadcasts/history', communicationHubController.getBroadcastHistory);
router.post('/broadcasts/acknowledge/:broadcastId', communicationHubController.acknowledgeBroadcast);
router.post('/schedule', communicationHubController.scheduleMessage);
router.get('/templates', communicationHubController.getMessageTemplates);
router.get('/status/:messageId', communicationHubController.getMessageStatus);

module.exports = router;
