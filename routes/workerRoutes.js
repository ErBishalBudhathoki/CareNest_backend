const express = require('express');
const router = express.Router();
const workerController = require('../controllers/workerController');
const { authenticateUser } = require('../middleware/auth');

router.get('/dashboard', authenticateUser, workerController.getDashboard);

module.exports = router;
