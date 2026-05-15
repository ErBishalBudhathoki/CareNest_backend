const { NotificationWorkflow } = require('./notifications');
const { EmergencyNotificationWorkflow } = require('./emergency');
const { InvoiceProcessingWorkflow } = require('./invoice');
const { 
  RecurringInvoiceCronWorkflow,
  OverdueRemindersCronWorkflow
} = require('./cron');
const {
  DunningCronWorkflow,
  ExpenseRemindersCronWorkflow,
  TimesheetRemindersCronWorkflow,
  ShiftRemindersCronWorkflow,
  EmailVerificationCronWorkflow
} = require('./system_cron');
const { EmployeeOnboardingWorkflow } = require('./employeeOnboarding');

module.exports = {
  NotificationWorkflow,
  EmergencyNotificationWorkflow,
  InvoiceProcessingWorkflow,
  RecurringInvoiceCronWorkflow,
  OverdueRemindersCronWorkflow,
  DunningCronWorkflow,
  ExpenseRemindersCronWorkflow,
  TimesheetRemindersCronWorkflow,
  ShiftRemindersCronWorkflow,
  EmailVerificationCronWorkflow,
  EmployeeOnboardingWorkflow
};
