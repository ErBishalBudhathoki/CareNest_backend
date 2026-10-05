const { NotificationWorkflow } = require('./notifications');
const { EmergencyNotificationWorkflow } = require('./emergency');
const { InvoiceProcessingWorkflow, SendInvoiceEmailWorkflow } = require('./invoice');
const { 
  RecurringInvoiceCronWorkflow,
  OverdueRemindersCronWorkflow,
  RecurringExpenseCronWorkflow,
} = require('./cron');
const {
  DunningCronWorkflow,
  ExpenseRemindersCronWorkflow,
  TimesheetRemindersCronWorkflow,
  ShiftRemindersCronWorkflow,
  EmailVerificationCronWorkflow,
  CleanupArtifactRegistryWorkflow,
  InvoiceAICronWorkflow,
  TrainingExpiryCronWorkflow,
  HolidayBalanceAccrualCronWorkflow
} = require('./system_cron');
const { EmployeeOnboardingWorkflow } = require('./employeeOnboarding');
const { authNotificationWorkflow } = require('./auth');
const { BulkInvoicesWorkflow } = require('./bulk');
const { ShiftLifecycleWorkflow, ShiftCancelWorkflow } = require('./shift');
const { LeaveApprovalEscalationWorkflow } = require('./leave');
const { JwtRotationCheckWorkflow, NdisCatalogSyncWorkflow } = require('./maintenance');

module.exports = {
  NotificationWorkflow,
  EmergencyNotificationWorkflow,
  InvoiceProcessingWorkflow,
  SendInvoiceEmailWorkflow,
  RecurringInvoiceCronWorkflow,
  OverdueRemindersCronWorkflow,
  RecurringExpenseCronWorkflow,
  DunningCronWorkflow,
  ExpenseRemindersCronWorkflow,
  TimesheetRemindersCronWorkflow,
  ShiftRemindersCronWorkflow,
  EmailVerificationCronWorkflow,
  EmployeeOnboardingWorkflow,
  CleanupArtifactRegistryWorkflow,
  authNotificationWorkflow,
  InvoiceAICronWorkflow,
  TrainingExpiryCronWorkflow,
  HolidayBalanceAccrualCronWorkflow,
  BulkInvoicesWorkflow,
  ShiftLifecycleWorkflow,
  ShiftCancelWorkflow,
  LeaveApprovalEscalationWorkflow,
  JwtRotationCheckWorkflow,
  NdisCatalogSyncWorkflow
};
