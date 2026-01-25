const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const errorHandler = require('../middleware/errorHandler');

/**
 * @route GET /api/leave/balances/:userEmail
 * @desc Get leave balances for a user
 * @access Private
 */
router.get('/balances/:userEmail', authenticateUser, leaveController.getLeaveBalances);

/**
 * @route POST /api/leave/request
 * @desc Submit a new leave request
 * @access Private
 */
router.post('/request', authenticateUser, leaveController.submitLeaveRequest);

/**
 * @route GET /api/leave/requests/:userEmail
 * @desc Get leave requests for a user
 * @access Private
 */
router.get('/requests/:userEmail', authenticateUser, leaveController.getLeaveRequests);

/**
 * @route GET /api/leave/forecast/:userEmail
 * @desc Calculate leave forecast
 * @access Private
 */
router.get('/forecast/:userEmail', authenticateUser, leaveController.getLeaveForecast);

/**
 * @route GET /api/leave/public-holidays
 * @desc Get public holidays
 * @access Private
 */
router.get('/public-holidays', authenticateUser, leaveController.getPublicHolidays);

/**
 * @route PUT /api/leave/request/:requestId/status
 * @desc Approve or reject a leave request
 * @access Private (Admin/Superadmin)
 */
router.put('/request/:requestId/status', authenticateUser, requireRoles(['admin', 'superadmin']), (req, res) => {
    // This will be implemented in leaveController or requestController
    res.status(501).json({ success: false, message: 'Approval endpoint not yet fully integrated with leaveController' });
});

// Error handling middleware for this router
router.use(errorHandler);

module.exports = router;
