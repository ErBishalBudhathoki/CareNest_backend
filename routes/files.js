const express = require('express');
const router = express.Router();

const { authenticateUser } = require('../middleware/auth');
const { downloadFile } = require('../controllers/fileController');

router.get('/download', authenticateUser, downloadFile);

module.exports = router;

