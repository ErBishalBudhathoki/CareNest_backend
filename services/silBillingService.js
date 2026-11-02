const SILRosterOfCare = require('../models/SILRosterOfCare');
const Client = require('../models/Client');
const Shift = require('../models/Shift');
const WorkedTime = require('../models/WorkedTime');
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

function parseWorkedHours(entry) {
  if (!entry) return 0;
  if (typeof entry.totalHours === 'number' && !isNaN(entry.totalHours) && entry.totalHours > 0) {
    return entry.totalHours;
  }
  if (typeof entry.totalSeconds === 'number' && !isNaN(entry.totalSeconds) && entry.totalSeconds > 0) {
    return round2(entry.totalSeconds / 3600);
  }
  if (typeof entry.timeWorked === 'string') {
    const parts = entry.timeWorked.split(':').map(Number);
    if (parts.length >= 2 && !parts.some(isNaN)) {
      const h = parts[0] || 0;
      const m = parts[1] || 0;
      const s = parts[2] || 0;
      return round2(h + m / 60 + s / 3600);
    }
  }
  return 0;
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
    const mode = String(opts.mode || 'roc_quota').toLowerCase();

    // Actual clocked hours retrieval for verified_timesheet and reconciled modes
    const actualHoursBySupport = new Map();
    let totalPlannedHours = 0;
    let totalActualHours = 0;
    let totalVarianceHours = 0;

    if (mode === 'verified_timesheet' || mode === 'reconciled') {
      const periodEndWithDay = new Date(periodTo.getTime() + MS_PER_DAY);
      let shifts = [];
      try {
        if (Shift && typeof Shift.find === 'function') {
          const query = Shift.find({
            organizationId,
            silRosterOfCareId: roc._id,
            startTime: { $gte: periodFrom, $lt: periodEndWithDay },
            status: { $ne: 'cancelled' },
            isActive: { $ne: false },
          });
          shifts = typeof query.lean === 'function' ? await query.lean() : await query;
        }
      } catch (err) {
        logger.warn('Failed to query shifts for SIL RoC billing', { error: err.message, rosterOfCareId });
      }

      const shiftList = Array.isArray(shifts) ? shifts : [];
      const shiftIds = shiftList.map((s) => s._id).filter(Boolean);
      const shiftSupportMap = new Map();
      for (const shift of shiftList) {
        const supportNum =
          shift.supportItems?.[0]?.itemNumber ||
          shift.supportItems?.[0]?.supportNumber ||
          shift.supportItems?.[0]?.supportItemNumber;
        if (supportNum && shift._id) {
          shiftSupportMap.set(String(shift._id), supportNum);
        }
      }

      let workedTimes = [];
      if (shiftIds.length > 0 && WorkedTime && typeof WorkedTime.find === 'function') {
        try {
          const query = WorkedTime.find({
            organizationId,
            $or: [{ silShiftId: { $in: shiftIds } }, { shiftId: { $in: shiftIds } }],
            isActive: { $ne: false },
          });
          workedTimes = typeof query.lean === 'function' ? await query.lean() : await query;
        } catch (err) {
          logger.warn('Failed to query worked times for SIL RoC billing', { error: err.message, rosterOfCareId });
        }
      }

      for (const wt of Array.isArray(workedTimes) ? workedTimes : []) {
        const hours = parseWorkedHours(wt);
        if (hours <= 0) continue;
        const supportNum =
          wt.ndisItem?.itemNumber ||
          wt.ndisItem?.supportItemNumber ||
          wt.ndisItem?.supportNumber ||
          wt.ndisItemNumber ||
          (wt.silShiftId && shiftSupportMap.get(String(wt.silShiftId))) ||
          (wt.shiftId && shiftSupportMap.get(String(wt.shiftId)));
        if (supportNum) {
          const current = actualHoursBySupport.get(supportNum) || 0;
          actualHoursBySupport.set(supportNum, round2(current + hours));
        }
      }
    }

    const lineItems = [];
    let subtotal = 0;

    if (mode === 'verified_timesheet') {
      for (const support of roc.supports || []) {
        const shiftType = String(support.shiftType || 'day').toLowerCase();
        const isSleepover = shiftType === 'sleepover';
        const actualHours = actualHoursBySupport.get(support.supportNumber) || 0;
        const quantity = isSleepover ? round2(actualHours / 8) : round2(actualHours);
        if (quantity <= 0) continue;

        totalActualHours = round2(totalActualHours + actualHours);
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
    } else {
      // 'roc_quota' or 'reconciled'
      for (const support of roc.supports || []) {
        const shiftType = String(support.shiftType || 'day').toLowerCase();
        const isSleepover = shiftType === 'sleepover';
        const daysPerWeek =
          Array.isArray(support.days) && support.days.length > 0
            ? support.days.length
            : 0;

        const quantity = isSleepover
          ? round2(
              (daysPerWeek ||
                Math.max(1, Math.round((Number(support.hoursPerWeek) || 0) / 8))) *
                weeks,
            )
          : round2((Number(support.hoursPerWeek) || 0) * weeks);
        if (quantity <= 0) continue;

        const plannedHours = isSleepover ? quantity * 8 : quantity;
        totalPlannedHours = round2(totalPlannedHours + plannedHours);

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

        // Reconciled variance check: if delivered hours exceed planned quota
        if (mode === 'reconciled') {
          const actualHours = actualHoursBySupport.get(support.supportNumber) || 0;
          totalActualHours = round2(totalActualHours + actualHours);
          if (actualHours > plannedHours) {
            const varianceHours = round2(actualHours - plannedHours);
            totalVarianceHours = round2(totalVarianceHours + varianceHours);
            const varianceTotal = round2(varianceHours * unitPrice);
            subtotal = round2(subtotal + varianceTotal);
            lineItems.push({
              supportItemNumber: support.supportNumber,
              supportItemName: `${support.supportName} (Unplanned / Variance Hours)`,
              price: unitPrice,
              quantity: varianceHours,
              unit: 'H',
              totalPrice: varianceTotal,
              date: periodFrom,
              organizationId,
            });
          }
        }
      }
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
        silBillingMode: mode,
        silReconciliation: {
          plannedHours: totalPlannedHours,
          actualHours: totalActualHours,
          varianceHours: totalVarianceHours,
        },
        internalNotes: `SIL roster of care ${roc._id} billed (${mode}) ${periodFrom
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
