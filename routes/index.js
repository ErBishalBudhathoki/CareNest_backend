const express = require('express');
const router = express.Router();

// Import Routes
const activeTimerRoutesV1 = require('./v1/activeTimers');
const auditRoutesV1 = require('./v1/audit');
const pricePromptRoutesV1 = require('./v1/pricePrompt');
const pricingRoutesV1 = require('./v1/pricing');
const invoiceRoutesV1 = require('./v1/invoice');
const organizationRoutesV1 = require('./v1/organization');
const metricsRoutes = require('./metrics');
const invoiceManagementRoutes = require('./invoiceManagement');
const authRoutes = require('./auth');
const authRoutesV2 = require('./auth_v2');
const authTestRoutes = require('./authTest');
const legacyAuthRoutes = require('./legacyAuth');
const initRoutes = require('./initRoutes');
const userRoutes = require('./user');
const securityDashboardRoutes = require('./securityDashboard');
const ocrRoutes = require('./ocrRoutes');
const schedulerRoutes = require('./scheduler_routes');
const apiUsageRoutes = require('./apiUsageRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const appointmentRoutes = require('./appointment');
const workerRoutes = require('./workerRoutes');
const complianceRoutes = require('./complianceRoutes');
const multiOrgRoutes = require('./multiOrgRoutes');
const adminInvoiceProfileRoutes = require('./adminInvoiceProfile');
const leaveRoutes = require('./leave');
const requestRoutes = require('./request');
const tripRoutes = require('./tripRoutes');
const payrollRoutes = require('./payrollRoutes');
const timesheetReminderRoutes = require('./timesheetReminderRoutes');
const earningsRoutes = require('./earningsRoutes');
const expenseRoutes = require('./expense');
const expenseReminderRoutes = require('./expenseReminderRoutes');
const onboardingRoutes = require('./onboarding');
const webhookRoutes = require('./webhookRoutes');
const businessRoutes = require('./business');
const clientRoutes = require('./client');
const assignmentRoutes = require('./assignmentRoutes');
const workedTimeRoutes = require('./workedTimeRoutes');
const settingsRoutes = require('./settingsRoutes');
const configRoutes = require('./config');
const clientPortalRoutes = require('./clientPortalRoutes');
const timesheetRoutes = require('./timesheetRoutes');
const paymentRoutes = require('./paymentRoutes');
const accountingRoutes = require('./accounting.routes');
const aiTimingRoutes = require('./aiTimingRoutes');
const calendarRoutes = require('./calendarRoutes');
const snoozeRoutes = require('./snoozeRoutes');
const voiceRoutes = require('./voiceRoutes');
const teamRoutes = require('./teamRoutes');
const emergencyRoutes = require('./emergencyRoutes');
const bankDetailsRoutes = require('./bankDetails');
const geofenceRoutes = require('./geofenceRoutes');
const holidayRoutes = require('./holidayRoutes');
const supportItemsRoutes = require('./supportItems');
const notesRoutes = require('./notesRoutes');
const notificationRoutes = require('./notificationRoutes');
const employeeTrackingRoutes = require('./employeeTracking');

// Mount Routes

// V1 Modular Routes
router.use('/active-timers', activeTimerRoutesV1);
router.use('/audit', auditRoutesV1);
router.use('/invoice', pricePromptRoutesV1); // Note: mounted under /invoice
router.use('/pricing', pricingRoutesV1);
router.use('/invoice', invoiceRoutesV1); // Note: also mounted under /invoice, express merges them
router.use('/organization', organizationRoutesV1);

// Core Feature Routes
router.use('/webhooks', webhookRoutes);
router.use('/', metricsRoutes);
router.use('/', invoiceManagementRoutes);
router.use('/auth', authRoutes);
router.use('/auth/v2', authRoutesV2);
router.use('/auth-test', authTestRoutes);
router.use('/', legacyAuthRoutes); // Mount legacy auth routes at root
router.use('/', initRoutes);
router.use('/user', userRoutes);
router.use('/security', securityDashboardRoutes);
router.use('/ocr', ocrRoutes);
router.use('/scheduler', schedulerRoutes);
router.use('/analytics', apiUsageRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/', appointmentRoutes);
router.use('/worker', workerRoutes);
router.use('/compliance', complianceRoutes);
router.use('/multiorg', multiOrgRoutes);
router.use('/admin-invoice-profile', adminInvoiceProfileRoutes); // Assuming path based on name, verifying below
router.use('/leave', leaveRoutes);
router.use('/requests', requestRoutes);
router.use('/trips', tripRoutes);
router.use('/payroll', payrollRoutes);
router.use('/reminders', timesheetReminderRoutes);
router.use('/earnings', earningsRoutes);
router.use('/expenses', expenseRoutes);
router.use('/reminders', expenseReminderRoutes); // Merges with timesheetReminderRoutes
router.use('/onboarding', onboardingRoutes);
router.use('/', businessRoutes);
router.use('/', clientRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/worked-time', workedTimeRoutes);
router.use('/settings', settingsRoutes);
router.use('/config', configRoutes);
router.use('/client-portal', clientPortalRoutes);
router.use('/timesheets', timesheetRoutes);
router.use('/payments', paymentRoutes);
router.use('/accounting', accountingRoutes);
router.use('/ai-timing', aiTimingRoutes);
router.use('/calendar', calendarRoutes);
router.use('/snooze', snoozeRoutes);
router.use('/voice', voiceRoutes);
router.use('/teams', teamRoutes);
router.use('/emergency', emergencyRoutes);
router.use('/bank-details', bankDetailsRoutes);
router.use('/geofence', geofenceRoutes);
router.use('/holidays', holidayRoutes);
router.use('/support-items', supportItemsRoutes);
router.use('/notes', notesRoutes);
router.use('/notifications', notificationRoutes);
router.use('/employee-tracking', employeeTrackingRoutes);
// router.use('/upload', uploadRoutes); // TODO: Add uploadRoutes import if needed

module.exports = router;
