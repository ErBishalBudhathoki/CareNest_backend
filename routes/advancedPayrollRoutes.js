const express = require('express');
const router = express.Router();
const advancedPayrollController = require('../controllers/advancedPayrollController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { requireOrgMembership } = require('../middleware/requireOrgMembership');

// Payroll is an organisation-scoped admin surface.
//
// `requireOrgMembership` resolves the organisation the caller names (header,
// query, body or params, falling back to their own) and refuses a caller who is
// not an active member of it. Without it, `GET /payslip/:userId/:period`
// returned any employee's salary to any authenticated user of any organisation:
// the handler never compared the requested user to the caller and never scoped
// the payroll query by organisation.
//
// The payslip read is deliberately declared BEFORE the role gate: an employee
// must be able to read their own payslip. That handler enforces self-or-admin
// and scopes the lookup to the caller's organisation, so a colleague's and
// another tenant's payslip are both refused. Everything else here (calculate,
// generate, summary, export) is organisation-wide payroll work and is
// admin-only — previously any employee could read the org-wide payroll summary
// and export the entire payroll.
router.use(authenticateUser);
router.use(requireOrgMembership);

router.get(
  '/payslip/:userId/:period',
  advancedPayrollController.getPayslip
);

router.use(requireRoles(['admin', 'owner']));

router.post(
  '/calculate',
  advancedPayrollController.calculatePayroll
);

router.post(
  '/generate-payslips',
  advancedPayrollController.generatePayslips
);

router.get(
  '/summary/:organizationId/:period',
  advancedPayrollController.getPayrollSummary
);

router.post(
  '/export',
  advancedPayrollController.exportPayrollData
);

module.exports = router;
