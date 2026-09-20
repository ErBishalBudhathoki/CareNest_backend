const logger = require('../../config/logger');
const {
  generateInvoicesFromAppointments,
} = require('../../services/bulkInvoiceService');

/**
 * Activity executing one bulk-invoice job. Retried by Temporal on failure;
 * the service layer is safe to re-run only for inputs that have not yet
 * been marked invoiced (idempotency comes from deterministic workflow IDs
 * + REJECT_DUPLICATE at start time).
 */
async function generateBulkInvoicesActivity(input) {
  try {
    const summary = await generateInvoicesFromAppointments({
      appointmentIds: input.appointmentIds,
      organizationId: input.organizationId,
      groupByClient: input.groupByClient,
      dueDate: input.dueDate,
    });
    logger.info('[Temporal] Bulk invoices generated', {
      invoiceCount: summary.invoiceCount,
      organizationId: input.organizationId,
    });
    return { success: true, ...summary };
  } catch (error) {
    logger.error('[Temporal] Bulk invoice generation failed', {
      error: error.message,
      organizationId: input && input.organizationId,
    });
    throw error;
  }
}

module.exports = {
  generateBulkInvoicesActivity,
};
