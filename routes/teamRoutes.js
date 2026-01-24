const express = require('express');
const router = express.Router();
const TeamController = require('../controllers/teamController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/', TeamController.create);
router.get('/:teamId/availability', TeamController.getAvailability);
router.put('/status', TeamController.updateStatus);

module.exports = router;
