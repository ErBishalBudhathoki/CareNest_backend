const ClientAssignment = require('../models/ClientAssignment');
const logger = require('../utils/logger');
const { formatDisplayDate } = require('../utils/dateHelpers');
const { InvoiceManagementService: invoiceManagementService } = require('./invoiceManagementService');
const crypto = require('crypto');

/**
 * Core bulk-invoice generation, extracted from bulkActionsController so it
 * can run both inline (legacy sync path) and inside a Temporal activity
 * (async path). Pure data logic — no req/res.
 */
class NoEligibleAppointmentsError extends Error {
  constructor() {
    super('No eligible appointments found for invoicing');
    this.statusCode = 404;
  }
}

async function generateInvoicesFromAppointments({
  appointmentIds,
  organizationId,
  groupByClient,
  dueDate,
}) {
  // Get appointments
  const appointments = await ClientAssignment.find({
    _id: { $in: appointmentIds },
    organizationId,
    status: 'completed',
    invoiced: { $ne: true },
  })
    .populate('clientId', 'firstName lastName email')
    .populate('serviceId', 'name rate');

  if (appointments.length === 0) {
    throw new NoEligibleAppointmentsError();
  }

  // Group by client if requested
  if (groupByClient) {
    const clientGroups = {};
    appointments.forEach((apt) => {
      const clientId = apt.clientId._id.toString();
      if (!clientGroups[clientId]) {
        clientGroups[clientId] = [];
      }
      clientGroups[clientId].push(apt);
    });

    let invoiceCount = 0;
    let summaryTotal = 0;

    // Create one invoice per client through the unified invoice pipeline
    // (plan-budget gate, NDIA price caps, fundingRoute stamping, analytics
    // line-item insert) so bulk invoices behave like ordinary ones.
    for (const [clientId, apts] of Object.entries(clientGroups)) {
      let subtotal = 0;
      const invoiceData = {
        organizationId,
        clientId,
        invoiceNumber: `INV-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
        issueDate: new Date(),
        dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        status: 'pending',
        subtotal: 0,
        tax: 0, // NDIS supports are GST-free under Australian tax law
        total: 0,
        financialSummary: {
          subtotal: 0,
          taxAmount: 0,
          discountAmount: 0,
          expenseAmount: 0,
          totalAmount: subtotal,
          currency: 'AUD',
        },
        lineItems: [],
      };

      apts.forEach((apt) => {
        const amount = apt.serviceId.rate * apt.duration;
        subtotal += amount;

        invoiceData.lineItems.push({
          appointmentId: apt._id,
          description: `${apt.serviceId.name} - ${formatDisplayDate(apt.date)}`,
          quantity: apt.duration,
          unitPrice: apt.serviceId.rate,
          amount,
        });
      });

      invoiceData.subtotal = subtotal;
      invoiceData.total = subtotal;
      invoiceData.financialSummary = {
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        expenseAmount: 0,
        totalAmount: subtotal,
        currency: 'AUD',
      };

      const summary = await invoiceManagementService.createInvoice(invoiceData);
      if (summary && summary.success === false) {
        throw new Error(summary.error || 'Failed to create bulk invoice');
      }

      invoiceCount += 1;
      summaryTotal += Number(summary?.data?.total || 0);
    }

    // Mark appointments as invoiced
    await ClientAssignment.updateMany(
      { _id: { $in: appointmentIds } },
      { $set: { invoiced: true } },
    );

    logger.info(`Bulk generated ${invoiceCount} invoices`, {
      organizationId,
      invoiceCount,
      appointmentCount: appointments.length,
      groupByClient,
    });

    return {
      invoiceCount,
      appointmentCount: appointments.length,
      totalAmount: summaryTotal,
    };
  }

  const payloads = [];
  // Create individual invoices
  appointments.forEach((apt) => {
    const amount = apt.serviceId.rate * apt.duration;

    payloads.push({
      organizationId,
      clientId: apt.clientId._id,
      invoiceNumber: `INV-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
      issueDate: new Date(),
      dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      status: 'pending',
      subtotal: amount,
      tax: 0, // NDIS supports are GST-free under Australian tax law
      total: amount,
      financialSummary: {
        subtotal: amount,
        taxAmount: 0,
        discountAmount: 0,
        expenseAmount: 0,
        totalAmount: amount,
        currency: 'AUD',
      },
      lineItems: [
        {
          appointmentId: apt._id,
          description: `${apt.serviceId.name} - ${formatDisplayDate(apt.date)}`,
          quantity: apt.duration,
          unitPrice: apt.serviceId.rate,
          amount,
        },
      ],
    });
  });

  let createdTotal = 0;
  for (const invoiceData of payloads) {
    const summary = await invoiceManagementService.createInvoice(invoiceData);
    if (summary && summary.success === false) {
      throw new Error(summary.error || 'Failed to create bulk invoice');
    }
    createdTotal += Number(summary?.data?.total ?? invoiceData.total ?? 0);
  }

  // Mark appointments as invoiced
  await ClientAssignment.updateMany(
    { _id: { $in: appointmentIds } },
    { $set: { invoiced: true } },
  );

  logger.info(`Bulk generated ${payloads.length} invoices`, {
    organizationId,
    invoiceCount: payloads.length,
    appointmentCount: appointments.length,
    groupByClient,
  });

  return {
    invoiceCount: payloads.length,
    appointmentCount: appointments.length,
    totalAmount: createdTotal,
  };
}

/**
 * Deterministic workflow ID so double-submits collapse instead of
 * double-invoicing (used with REJECT_DUPLICATE).
 */
function bulkInvoicesWorkflowId(organizationId, appointmentIds) {
  const sorted = [...appointmentIds].map(String).sort().join(',');
  const hash = crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16);
  return `bulk-invoices-${organizationId}-${hash}`;
}

module.exports = {
  generateInvoicesFromAppointments,
  bulkInvoicesWorkflowId,
  NoEligibleAppointmentsError,
};
