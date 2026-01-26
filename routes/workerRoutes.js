const express = require('express');
const router = express.Router();
const workerController = require('../controllers/workerController');
const { protect } = require('../middleware/auth'); // Assuming protect middleware exists

router.get('/dashboard', protect, workerController.getDashboard);

module.exports = router;
