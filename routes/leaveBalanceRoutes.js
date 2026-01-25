const express = require('express');
const router = express.Router();
const LeaveBalanceController = require('../controllers/leaveBalanceController');
const { authenticateUser } = require('../middleware/auth'); // Assuming auth middleware exists

router.get('/:userEmail', authenticateUser, LeaveBalanceController.getBalances);
router.put('/:userEmail', authenticateUser, LeaveBalanceController.updateBalance);

module.exports = router;
