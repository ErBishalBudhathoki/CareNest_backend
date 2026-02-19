const express = require('express');
const router = express.Router();
const bulkActionsController = require('../controllers/bulkActionsController');
const { authenticateUser } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Rate limiter for bulk actions (lower limit due to heavy operations)
const bulkActionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: 'Too many bulk action requests, please try again later',
});

// Apply authentication and rate limiting to all routes
router.use(authenticateUser);
router.use(bulkActionsLimiter);

// Bulk Timesheet Approval
router.post('/approve-timesheets', bulkActionsController.approveTimesheets);
router.post('/reject-timesheets', bulkActionsController.rejectTimesheets);

// Bulk Invoice Generation
router.post('/generate-invoices', bulkActionsController.generateInvoices);
router.post('/preview-invoices', bulkActionsController.previewInvoices);

// Bulk Worker Assignment
router.post('/assign-shifts', bulkActionsController.assignShifts);
router.post('/suggest-assignments', bulkActionsController.suggestAssignments);

// Bulk Messaging
router.post('/send-messages', bulkActionsController.sendMessages);
router.post('/schedule-messages', bulkActionsController.scheduleMessages);

module.exports = router;
