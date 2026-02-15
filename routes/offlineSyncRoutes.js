const express = require('express');
const router = express.Router();
const offlineSyncController = require('../controllers/offlineSyncController');

// Queue offline data
router.post('/queue', offlineSyncController.queueOfflineData);

// Sync offline data
router.post('/sync', offlineSyncController.syncOfflineData);

// Get offline-capable data
router.get('/data/:userId', offlineSyncController.getOfflineCapableData);

// Resolve conflict
router.post('/resolve-conflict', offlineSyncController.resolveConflict);

module.exports = router;
