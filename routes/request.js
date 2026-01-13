const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');

router.post('/create', requestController.createRequest);
router.get('/organization/:organizationId', requestController.getRequests);
router.patch('/:requestId/status', requestController.updateRequestStatus);

module.exports = router;
