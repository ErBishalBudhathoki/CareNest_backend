const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { authenticateUser } = require('../middleware/auth');

// Apply authentication middleware to all routes
router.use(authenticateUser);

// Settings routes
router.get('/settings', NotificationController.getSettings);
router.put('/settings', NotificationController.updateSettings);

// History routes
router.get('/history', NotificationController.getHistory);
router.put('/:id/read', NotificationController.markAsRead);

module.exports = router;
