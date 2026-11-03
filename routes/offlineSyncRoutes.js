const express = require('express');
const router = express.Router();
const offlineSyncController = require('../controllers/offlineSyncController');
const { authenticateUser } = require('../middleware/auth');
const { organizationContextMiddleware } = require('../middleware/organizationContext');

// Milestone 7.1: Authenticate user & attach organization context when token is present
router.use((req, res, next) => {
  if (req.headers.authorization) {
    return authenticateUser(req, res, () => {
      organizationContextMiddleware(req, res, next);
    });
  }
  next();
});

// Queue offline data
router.post('/queue', offlineSyncController.queueOfflineData);

// Sync offline data
router.post('/sync', offlineSyncController.syncOfflineData);

// Get offline-capable data
router.get('/data/:userId', offlineSyncController.getOfflineCapableData);

// Resolve conflict
router.post('/resolve-conflict', offlineSyncController.resolveConflict);

module.exports = router;
