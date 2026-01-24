const express = require('express');
const router = express.Router();
const CalendarController = require('../controllers/calendarController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/sync', CalendarController.sync);
router.get('/upcoming', CalendarController.getUpcoming);

module.exports = router;
