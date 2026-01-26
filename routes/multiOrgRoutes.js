const express = require('express');
const router = express.Router();
const multiOrgController = require('../controllers/multiOrgController');
const { authenticateUser } = require('../middleware/auth');

router.get('/rollup', authenticateUser, multiOrgController.getRollup);

module.exports = router;
