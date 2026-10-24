const SILRosterOfCare = require('../models/SILRosterOfCare');
const Client = require('../models/Client');
const { Invoice } = require('../models/Invoice');
const {
  InvoiceManagementService: invoiceManagementService,
} = require('./invoiceManagementService');
const logger = require('../config/logger');

/**
 * SIL → billing wiring (Phase 4 → Phase 6).
 * See docs/SIL_MANAGEMENT_SPEC.md section 7 ("Accepted RoC line items become
 * billable units; NDIA-managed → claim CSV, plan/self → invoice PDF").
 *
 * An active roster-of-care's weekly supports are prorated over a billing
 * period and turned into client invoice line items. The invoice inherits the
 * participant's funding route: the `billing` block is stamped by the Invoice
 * pre-save hook from `Client.fundingType`, so NDIA-managed work flows into the
 * claim CSV and plan/self-managed work into a PDF.
 *
 * This service never writes NDIA claim lines directly — it produces the
 * invoice the claim service reads, keeping one code path for billing artefacts.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Inclusive day count between two dates (both UTC-midnight normalised). */
function inclusiveDays(from, to) {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((end - start) / MS_PER_DAY) + 1;
}

function startOfUtcDay(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

class SILBillingService {
  /**
   * Generate a client invoice for one billing period of an active RoC.
   *
   * @param {string} organizationId
   * @param {string} rosterOfCareId
   * @param {Object} opts - { from, to, dueDate? }
   * @param {string} actor
   * @returns {Promise<Object>} one of
   *   { notFound } | { invalidState, status } | { invalidPeriod, message } |
   *   { clientNotFound } | { conflict, existingInvoiceId } | { invoice, billing }
   */
  async generateInvoiceFromRosterOfCare(organizationId, rosterOfCareId, opts = {}, actor = '') {
    const from = opts.from ? new Date(opts.from) : null;
    const to = opts.to ? new Date(opts.to) : null;

    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      return {
        invalidPeriod: true,
        message: 'Invalid period: from/to are required and to >= from.',
      };
    }

    const roc = await SILRosterOfCare.findOne({ _id: rosterOfCareId, organizationId });
    if (!roc) return { notFound: true };
    if (!['active', 'under_review'].includes(roc.status)) {
      return { invalidState: true, status: roc.status };
    }

    const client = await Client.findOne({ _id: roc.clientId, organizationId }).lean();
    if (!client) return { clientNotFound: true };

    const periodFrom = startOfUtcDay(from);
    const periodTo = startOfUtcDay(to);

    // Idempotency: never bill the same RoC for the same period twice.
    const existing = await Invoice.findOne({
      organizationId,
      'metadata.silRosterOfCareId': roc._id,
      'metadata.silPeriod.from': periodFrom,
      'metadata.silPeriod.to': periodTo,
      'deletion.isDeleted': { $ne: true },
    })
      .select('_id invoiceNumber')
      .lean();
    if (existing) {
      return { conflict: true, existingInvoiceId: existing._id?.toString?.() || null };
    }

    const days = inclusiveDays(periodFrom, periodTo);
    const weeks = days / 7;

    const lineItems = [];
    let subtotal = 0;
    for (const support of roc.supports || []) {
      const shiftType = String(support.shiftType || 'day').toLowerCase();
      const isSleepover = shiftType === 'sleepover';
      const daysPerWeek =
        Array.isArray(support.days) && support.days.length > 0
          ? support.days.length
          : 0;

      // A sleepover is a fixed fee per shift, not hours × rate. Prefer the
      // explicit weekly pattern; fall back to an 8-hour-per-shift assumption
      // for legacy quotes that only stored hours.
      const quantity = isSleepover
        ? round2(
            (daysPerWeek ||
              Math.max(1, Math.round((Number(support.hoursPerWeek) || 0) / 8))) *
              weeks,
          )
        : round2((Number(support.hoursPerWeek) || 0) * weeks);
      if (quantity <= 0) continue;

      const unitPrice = round2(support.unitPrice);
      const totalPrice = round2(quantity * unitPrice);
      subtotal = round2(subtotal + totalPrice);
      lineItems.push({
        supportItemNumber: support.supportNumber,
        supportItemName: support.supportName,
        price: unitPrice,
        quantity,
        unit: isSleepover ? 'E' : 'H',
        totalPrice,
        date: periodFrom,
        organizationId,
      });
    }

    if (lineItems.length === 0) {
      return {
        invalidState: true,
        status: roc.status,
        message: 'Roster of care has no billable supports for this period.',
      };
    }

    const dueDate = opts.dueDate
      ? new Date(opts.dueDate)
      : new Date(periodTo.getTime() + 30 * MS_PER_DAY);

    // Client stores the participant name in `clientFirstName`/`clientLastName`
    // (the `firstName`/`lastName` aliases are legacy). Read the canonical fields
    // first so the invoice is addressed to a real name.
    const clientName =
      [client.clientFirstName, client.clientLastName].filter(Boolean).join(' ').trim() ||
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
    const clientEmail = client.clientEmail || client.email || '';

    const invoiceNumber = await invoiceManagementService.generateInvoiceNumber(organizationId, {
      clientId: String(roc.clientId),
      clientName,
      clientEmail,
    });

    const invoiceData = {
      organizationId,
      invoiceNumber,
      clientId: String(roc.clientId),
      clientEmail,
      clientName,
      lineItems,
      // NDIS supports are GST-free; no tax is added here.
      financialSummary: {
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        expenseAmount: 0,
        totalAmount: subtotal,
        currency: 'AUD',
        exchangeRate: 1.0,
        paymentTerms: 30,
        dueDate,
      },
      metadata: {
        invoiceType: 'client',
        generationMethod: 'sil_roster_of_care',
        category: 'SIL',
        silRosterOfCareId: roc._id,
        silPeriod: { from: periodFrom, to: periodTo },
        internalNotes: `SIL roster of care ${roc._id} billed ${periodFrom
          .toISOString()
          .slice(0, 10)}..${periodTo.toISOString().slice(0, 10)}`,
      },
      workflow: {
        status: 'generated',
        approvalRequired: false,
        currentStep: 'generated',
        nextAction: 'send',
      },
      auditTrail: {
        createdBy: actor || 'system',
        createdAt: new Date(),
        updatedBy: actor || 'system',
        updatedAt: new Date(),
        version: 1,
        changeHistory: [
          {
            timestamp: new Date(),
            userId: actor || 'system',
            action: 'created',
            changes: { source: 'sil_roster_of_care' },
            reason: 'SIL roster of care billed',
          },
        ],
      },
      deletion: { isDeleted: false, canRestore: true },
    };

    const result = await invoiceManagementService.createInvoice(invoiceData);
    if (!result.success) {
      const err = new Error(result.error || 'Failed to create SIL invoice');
      err.statusCode = result.statusCode || 500;
      err.code = result.errorCode || 'SIL_INVOICE_FAILED';
      err.details = result.planValidation || null;
      throw err;
    }

    logger.business('SIL RoC invoiced', {
      event: 'sil_roc_invoiced',
      organizationId,
      rosterOfCareId: roc._id.toString(),
      invoiceId: result.data._id?.toString?.(),
      amount: subtotal,
    });

    return {
      invoice: result.data,
      billing: result.data.billing || null,
    };
  }
}

module.exports = new SILBillingService();
module.exports.round2 = round2;
module.exports.inclusiveDays = inclusiveDays;
