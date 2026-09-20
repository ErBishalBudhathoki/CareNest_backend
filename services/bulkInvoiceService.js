const ClientAssignment = require('../models/ClientAssignment');
const Invoice = require('../models/Invoice');
const InvoiceLineItem = require('../models/InvoiceLineItem');
const logger = require('../utils/logger');
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

  const invoices = [];
  const lineItems = [];

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

    // Create one invoice per client
    for (const [clientId, apts] of Object.entries(clientGroups)) {
      const invoice = new Invoice({
        organizationId,
        clientId,
        invoiceNumber: `INV-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
        issueDate: new Date(),
        dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        status: 'pending',
        subtotal: 0,
        tax: 0,
        total: 0,
      });

      let subtotal = 0;
      apts.forEach((apt) => {
        const amount = apt.serviceId.rate * apt.duration;
        subtotal += amount;

        lineItems.push({
          invoiceId: invoice._id,
          appointmentId: apt._id,
          description: `${apt.serviceId.name} - ${apt.date.toLocaleDateString()}`,
          quantity: apt.duration,
          unitPrice: apt.serviceId.rate,
          amount,
        });
      });

      invoice.subtotal = subtotal;
      invoice.tax = subtotal * 0.1; // 10% tax
      invoice.total = subtotal + invoice.tax;
      invoices.push(invoice);
    }
  } else {
    // Create individual invoices
    appointments.forEach((apt) => {
      const amount = apt.serviceId.rate * apt.duration;
      const invoice = new Invoice({
        organizationId,
        clientId: apt.clientId._id,
        invoiceNumber: `INV-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
        issueDate: new Date(),
        dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        status: 'pending',
        subtotal: amount,
        tax: amount * 0.1,
        total: amount * 1.1,
      });

      lineItems.push({
        invoiceId: invoice._id,
        appointmentId: apt._id,
        description: `${apt.serviceId.name} - ${apt.date.toLocaleDateString()}`,
        quantity: apt.duration,
        unitPrice: apt.serviceId.rate,
        amount,
      });

      invoices.push(invoice);
    });
  }

  // Save invoices and line items
  await Invoice.insertMany(invoices);
  await InvoiceLineItem.insertMany(lineItems);

  // Mark appointments as invoiced
  await ClientAssignment.updateMany(
    { _id: { $in: appointmentIds } },
    { $set: { invoiced: true } }
  );

  logger.info(`Bulk generated ${invoices.length} invoices`, {
    organizationId,
    invoiceCount: invoices.length,
    appointmentCount: appointments.length,
    groupByClient,
  });

  return {
    invoiceCount: invoices.length,
    appointmentCount: appointments.length,
    totalAmount: invoices.reduce((sum, inv) => sum + inv.total, 0),
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
