const ClientAssignment = require('../models/ClientAssignment');
const { Invoice } = require('../models/Invoice');
const logger = require('../utils/logger');
const { formatDisplayDate } = require('../utils/dateHelpers');
const { InvoiceManagementService: invoiceManagementService } = require('./invoiceManagementService');
const crypto = require('crypto');

/**
 * Stable key for the WHOLE request, derived from the submitted IDs (not from
 * the filtered appointment list). A Temporal activity retry re-sends the same
 * IDs, so keys stay identical even after some appointments were already marked
 * invoiced by the first (partially failed) attempt.
 */
function _requestKey(organizationId, appointmentIds) {
  const sorted = [...appointmentIds].map(String).sort().join(',');
  return crypto
    .createHash('sha256')
    .update(`${organizationId}:${sorted}`)
    .digest('hex')
    .slice(0, 20);
}

/**
 * createInvoice() returns duplicateKey:true for Mongo error 11000 (the
 * unique invoiceNumber / metadata.idempotencyKey indexes). On a retry that is
 * SUCCESS, not a failure — otherwise the activity retries forever and reports
 * a 500 for a bill that was already created.
 */
async function _createInvoiceOrSkip(invoiceData) {
  const summary = await invoiceManagementService.createInvoice(invoiceData);
  if (summary && summary.success === false) {
    if (summary.duplicateKey) {
      const existing = await Invoice.findOne({
        invoiceNumber: invoiceData.invoiceNumber,
        organizationId: invoiceData.organizationId,
      })
        .select('total financialSummary.totalAmount')
        .lean();
      return { created: false, total: Number(existing?.total ?? invoiceData.total ?? 0) };
    }
    throw new Error(summary.error || 'Failed to create bulk invoice');
  }
  return {
    created: true,
    total: Number(summary?.data?.total ?? invoiceData.total ?? 0),
  };
}

/** Mark ONLY the appointments we actually fetched, scoped to this tenant. */
async function _markInvoiced(appointments, organizationId) {
  const ids = appointments.map((apt) => apt._id);
  if (ids.length === 0) return;
  await ClientAssignment.updateMany(
    { _id: { $in: ids }, organizationId },
    { $set: { invoiced: true } },
  );
}

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
  const requestKey = _requestKey(organizationId, appointmentIds);

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
        invoiceNumber: `INV-BULK-${requestKey}-${crypto
          .createHash('sha256')
          .update(String(clientId))
          .digest('hex')
          .slice(0, 10)}`,
        metadata: {
          generationMethod: 'bulk_appointments',
          idempotencyKey: `bulk:${requestKey}:client:${clientId}`,
        },
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

      const outcome = await _createInvoiceOrSkip(invoiceData);
      if (outcome.created) invoiceCount += 1;
      summaryTotal += outcome.total;

      // Mark this group immediately. If a later group fails, the retry only
      // sees the unpaid remainder instead of re-billing the whole request.
      await _markInvoiced(apts, organizationId);
    }

    // Belt-and-braces: tenant-scoped, and only IDs we actually read.
    await _markInvoiced(appointments, organizationId);

    logger.info(`Bulk generated ${invoiceCount} invoices`, {
      organizationId,
      invoiceCount,
      skippedDuplicates: Object.keys(clientGroups).length - invoiceCount,
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
      invoiceNumber: `INV-BULK-${requestKey}-${crypto
        .createHash('sha256')
        .update(String(apt._id))
        .digest('hex')
        .slice(0, 10)}`,
      metadata: {
        generationMethod: 'bulk_appointments',
        idempotencyKey: `bulk:${requestKey}:appointment:${apt._id}`,
      },
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
  let createdCount = 0;
  for (let i = 0; i < payloads.length; i += 1) {
    const invoiceData = payloads[i];
    const outcome = await _createInvoiceOrSkip(invoiceData);
    if (outcome.created) createdCount += 1;
    createdTotal += outcome.total;
    // Mark each appointment as soon as its bill exists (retry-safe).
    await _markInvoiced([appointments[i]], organizationId);
  }

  // Belt-and-braces: tenant-scoped, and only IDs we actually read.
  await _markInvoiced(appointments, organizationId);

  logger.info(`Bulk generated ${createdCount} invoices`, {
    organizationId,
    invoiceCount: createdCount,
    skippedDuplicates: payloads.length - createdCount,
    appointmentCount: appointments.length,
    groupByClient,
  });

  return {
    invoiceCount: createdCount,
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
