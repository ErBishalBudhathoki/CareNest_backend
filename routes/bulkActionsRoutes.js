const express = require('express');
const router = express.Router();
const bulkActionsController = require('../controllers/bulkActionsController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { requireOrgMembership } = require('../middleware/requireOrgMembership');
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
router.use(requireOrgMembership);
router.use(bulkActionsLimiter);

// Organisation-wide actions are admin work. Approving or rejecting the whole
// organisation's timesheets, generating or previewing its invoices, and
// broadcasting messages to everyone in it were previously available to any
// member: a two-tenant probe ran the org-wide timesheet approval path, and was
// allowed through, with an employee token.
const requireAdmin = requireRoles(['admin', 'owner']);

// Bulk Timesheet Approval
router.post('/approve-timesheets', requireAdmin, bulkActionsController.approveTimesheets);
router.post('/reject-timesheets', requireAdmin, bulkActionsController.rejectTimesheets);

// Bulk Invoice Generation (org-bound: callers send organizationId in body)
router.post(
  '/generate-invoices',
  requireAdmin,
  organizationContextMiddleware,
  requireOrganizationMatch('organizationId'),
  bulkActionsController.generateInvoices
);
router.post('/preview-invoices', requireAdmin, bulkActionsController.previewInvoices);

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

// Bulk Worker Assignment — rostering the organisation's staff is admin work.
router.post('/assign-shifts', requireAdmin, bulkActionsController.assignShifts);
router.post('/suggest-assignments', requireAdmin, bulkActionsController.suggestAssignments);

// Bulk Messaging
router.post('/send-messages', requireAdmin, bulkActionsController.sendMessages);
router.post('/schedule-messages', requireAdmin, bulkActionsController.scheduleMessages);

module.exports = router;
