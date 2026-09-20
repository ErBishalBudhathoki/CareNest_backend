const express = require('express');
const router = express.Router();
const bulkActionsController = require('../controllers/bulkActionsController');
const { authenticateUser } = require('../middleware/auth');
const {
  organizationContextMiddleware,
  requireOrganizationMatch,
} = require('../middleware/organizationContext');
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

// Bulk Invoice Generation (org-bound: callers send organizationId in body)
router.post(
  '/generate-invoices',
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  bulkActionsController.generateInvoices
);
router.post('/preview-invoices', bulkActionsController.previewInvoices);

// Job status for async bulk runs (?async=true on generate-invoices).
// Scoped: callers can only poll jobs for their own organization — the
// workflow ID embeds the org, and mismatches are rejected here.
router.get('/jobs/:workflowId', organizationContextMiddleware, async (req, res) => {
  const { workflowId } = req.params;
  const callerOrgs = new Set(
    [
      req.organizationContext && req.organizationContext.organizationId,
      req.user && req.user.organizationId,
      req.query.organizationId,
    ]
      .filter(Boolean)
      .map(String),
  );
  const match = String(workflowId || '').match(/^bulk-invoices-(.+)-[0-9a-f]{16}$/);
  if (!match || !callerOrgs.has(match[1])) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this job',
    });
  }
  try {
    const TemporalManager = require('../core/TemporalManager');
    const status = await TemporalManager.describeWorkflow(workflowId);
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: 'Job not found',
    });
  }
});

// Bulk Worker Assignment
router.post('/assign-shifts', bulkActionsController.assignShifts);
router.post('/suggest-assignments', bulkActionsController.suggestAssignments);

// Bulk Messaging
router.post('/send-messages', bulkActionsController.sendMessages);
router.post('/schedule-messages', bulkActionsController.scheduleMessages);

module.exports = router;
