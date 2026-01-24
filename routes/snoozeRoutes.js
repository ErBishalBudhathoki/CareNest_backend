const express = require('express');
const router = express.Router();
const SnoozeController = require('../controllers/snoozeController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/rules', SnoozeController.createRule);
router.get('/rules', SnoozeController.getRules);
router.post('/check', SnoozeController.checkSnooze);

module.exports = router;
