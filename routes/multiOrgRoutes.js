const express = require('express');
const router = express.Router();
const multiOrgController = require('../controllers/multiOrgController');
const { protect } = require('../middleware/auth');

router.get('/rollup', protect, multiOrgController.getRollup);

module.exports = router;
