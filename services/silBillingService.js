const SILRosterOfCare = require('../models/SILRosterOfCare');
const Client = require('../models/Client');
const Shift = require('../models/Shift');
const WorkedTime = require('../models/WorkedTime');
const SILOccupancy = require('../models/SILOccupancy');
const silRatioService = require('./silRatioService');
const { Invoice } = require('../models/Invoice');
const {
  InvoiceManagementService: invoiceManagementService,
} = require('./invoiceManagementService');
const logger = require('../config/logger');
const { normalizeToIsoDate } = require('../utils/dateHelpers');

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

function parseDateInput(value) {
  if (!value) return null;
  const iso = normalizeToIsoDate(value);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function safeFind(model, filter) {
  if (!model || typeof model.find !== 'function') return [];
  try {
    const query = model.find(filter);
    if (!query) return [];
    if (typeof query.lean === 'function') {
      return (await query.lean()) || [];
    }
    return (await query) || [];
  } catch (err) {
    logger.warn('safeFind query failed', { error: err.message, filter });
    return [];
  }
}

/**
 * Safely find a single document, handling mocks and errors gracefully (Milestone 2.1).
 */
async function safeFindOne(model, filter, opts = {}) {
  if (!model || typeof model.findOne !== 'function') return null;
  try {
    let query = model.findOne(filter);
    if (!query) return null;
    if (opts.sort && typeof query.sort === 'function') {
      query = query.sort(opts.sort);
    }
    if (typeof query.lean === 'function') {
      return (await query.lean()) || null;
    }
    return (await query) || null;
  } catch (err) {
    logger.warn('safeFindOne query failed', { error: err.message, filter });
    return null;
  }
}

/**
 * Calculate unclaimable absence days falling within a billing period (Milestone 2.1).
 * Under NDIA guidelines:
 *  - When a participant is admitted to hospital, claims may continue for up to 28 consecutive days.
 *  - Days exceeding maxClaimableDays (default 28) are non-claimable and must be deducted from the billing period.
 *  - Non-hospital absences (e.g. holidays or family leave) also deduct any days exceeding allowable leave limits.
 *
 * @param {Array} absences - Array of absence records from SILOccupancy
 * @param {Date} periodFrom - Start of billing period (UTC midnight)
 * @param {Date} periodTo - End of billing period (UTC midnight)
 * @returns {{ totalUnclaimableDays: number, deductions: Array }}
 */
function calculateUnclaimableAbsenceDays(absences = [], periodFrom, periodTo) {
  let totalUnclaimableDays = 0;
  const deductions = [];

  for (const abs of absences) {
    if (!abs || !abs.startDate) continue;
    const absStart = startOfUtcDay(new Date(abs.startDate));
    const absEnd = abs.endDate ? startOfUtcDay(new Date(abs.endDate)) : periodTo;

    // Check if absence overlaps billing window
    if (absEnd < periodFrom || absStart > periodTo) continue;

    const maxClaimable =
      typeof abs.maxClaimableDays === 'number' ? abs.maxClaimableDays : 28;

    // The claimable portion of the absence spans from absStart for maxClaimable days:
    // [absStart, absStart + (maxClaimable - 1) days].
    // Unclaimable days begin after maxClaimable days of absence:
    const unclaimableStart = new Date(absStart.getTime() + maxClaimable * MS_PER_DAY);

    // If the absence lasted longer than maxClaimable days:
    if (unclaimableStart <= absEnd) {
      // Find overlap of [unclaimableStart, absEnd] with [periodFrom, periodTo]:
      const overlapStart = unclaimableStart > periodFrom ? unclaimableStart : periodFrom;
      const overlapEnd = absEnd < periodTo ? absEnd : periodTo;

      if (overlapStart <= overlapEnd) {
        const unclaimableCount = inclusiveDays(overlapStart, overlapEnd);
        totalUnclaimableDays += unclaimableCount;
        deductions.push({
          absenceId: abs._id?.toString() || abs.id,
          reason: abs.reason || 'hospital',
          unclaimableDays: unclaimableCount,
          from: overlapStart.toISOString().slice(0, 10),
          to: overlapEnd.toISOString().slice(0, 10),
          maxClaimableDays: maxClaimable,
        });
      }
    }
  }

  return { totalUnclaimableDays, deductions };
}

function parseWorkedHours(entry) {
  if (!entry) return 0;
  const numHours = Number(entry.totalHours);
  if (!Number.isNaN(numHours) && numHours > 0) {
    return round2(numHours);
  }
  const numSec = Number(entry.totalSeconds);
  if (!Number.isNaN(numSec) && numSec > 0) {
    return round2(numSec / 3600);
  }
  if (typeof entry.timeWorked === 'string') {
    const trimmed = entry.timeWorked.trim();
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':').map(Number);
      if (parts.length >= 2 && !parts.some(Number.isNaN)) {
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;
        return round2(h + m / 60 + s / 3600);
      }
    }
    const parsedTime = parseFloat(trimmed);
    if (!Number.isNaN(parsedTime) && parsedTime > 0) {
      return round2(parsedTime);
    }
  }
  if (entry.startTime && entry.endTime) {
    const start = new Date(entry.startTime).getTime();
    const end = new Date(entry.endTime).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      return round2((end - start) / (1000 * 60 * 60));
    }
  }
  return 0;
}

function resolveSupportNumber(wt, shift, rocSupports = []) {
  const direct =
    wt?.supportItemNumber ||
    wt?.supportNumber ||
    wt?.itemNumber ||
    wt?.ndisItemNumber ||
    wt?.ndisItem?.itemNumber ||
    wt?.ndisItem?.supportItemNumber ||
    wt?.ndisItem?.supportNumber ||
    (typeof wt?.ndisItem === 'string' ? wt.ndisItem : null);
  if (direct) return String(direct).trim();

  const shiftSupport =
    shift?.supportItems?.[0]?.itemNumber ||
    shift?.supportItems?.[0]?.supportNumber ||
    shift?.supportItems?.[0]?.supportItemNumber ||
    shift?.supportNumber ||
    shift?.supportItemNumber;
  if (shiftSupport) return String(shiftSupport).trim();

  if (Array.isArray(rocSupports) && rocSupports.length === 1) {
    return String(rocSupports[0].supportNumber || rocSupports[0].itemNumber || '').trim();
  }

  const shiftType = String(shift?.shiftType || wt?.shiftType || '').toLowerCase();
  if (shiftType && Array.isArray(rocSupports)) {
    const match = rocSupports.find(
      (s) => String(s.shiftType || '').toLowerCase() === shiftType,
    );
    if (match) {
      return String(match.supportNumber || match.itemNumber || '').trim();
    }
  }

  return null;
}

class SILBillingService {
  /**
   * Generate a client invoice for one billing period of an active RoC.
   *
   * @param {string} organizationId
   * @param {string} rosterOfCareId
   * @param {Object} opts - { from, to, dueDate?, mode?: 'roc_quota' | 'verified_timesheet' | 'reconciled' }
   * @param {string} actor
   * @returns {Promise<Object>} one of
   *   { notFound } | { invalidState, status } | { invalidPeriod, message } |
   *   { clientNotFound } | { conflict, existingInvoiceId } | { invoice, billing }
   */
  async generateInvoiceFromRosterOfCare(organizationId, rosterOfCareId, opts = {}, actor = '') {
    const from = parseDateInput(opts.from);
    const to = parseDateInput(opts.to);

    if (!from || !to || to < from) {
      return {
        invalidPeriod: true,
        message: 'Invalid period: from/to are required and to >= from.',
      };
    }

    const mode = String(opts.mode || 'roc_quota').toLowerCase();
    if (!['roc_quota', 'verified_timesheet', 'reconciled'].includes(mode)) {
      return {
        invalidPeriod: true,
        message: `Invalid billing mode '${opts.mode}'. Allowed: roc_quota, verified_timesheet, reconciled.`,
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
    const periodEndExclusive = new Date(periodTo.getTime() + MS_PER_DAY);

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

    // Milestone 2.1: Check for temporary absences and hospital leave exceeding 28 days.
    // Under NDIA guidelines, SIL hospital leave is claimable for up to 28 consecutive days.
    // Any days exceeding 28 are non-claimable and deducted from the billable period.
    let unclaimableAbsenceDays = 0;
    let absenceDeductionsInfo = null;

    try {
      const occupancy = await safeFindOne(
        SILOccupancy,
        {
          organizationId,
          clientId: roc.clientId,
          status: { $in: ['active', 'ended'] },
          ...(roc.propertyId ? { propertyId: roc.propertyId } : {}),
        },
        { sort: { startDate: -1 } },
      );

      if (occupancy && Array.isArray(occupancy.absences) && occupancy.absences.length > 0) {
        const { totalUnclaimableDays, deductions } = calculateUnclaimableAbsenceDays(
          occupancy.absences,
          periodFrom,
          periodTo,
        );
        if (totalUnclaimableDays > 0) {
          unclaimableAbsenceDays = totalUnclaimableDays;
          absenceDeductionsInfo = {
            totalUnclaimableDays,
            nominalPeriodDays: days,
            billableDays: Math.max(0, days - totalUnclaimableDays),
            deductions,
          };
        }
      }
    } catch (occupancyErr) {
      // Non-fatal: log warning and continue with nominal days
      logger.warn('Failed to evaluate SIL occupancy absences during billing', {
        error: occupancyErr.message,
        organizationId,
        clientId: String(roc.clientId),
      });
    }

    const billableDays = Math.max(0, days - unclaimableAbsenceDays);
    if (billableDays === 0) {
      return {
        invalidState: true,
        status: roc.status,
        message: 'All days in this period were non-claimable absence days under NDIS rules.',
      };
    }
    const weeks = billableDays / 7;

    const lineItems = [];
    let subtotal = 0;
    let silReconciliation = null;

    if (mode === 'verified_timesheet' || mode === 'reconciled') {
      const shifts = await safeFind(Shift, {
        organizationId,
        silRosterOfCareId: roc._id,
        startTime: { $gte: periodFrom, $lt: periodEndExclusive },
        isActive: { $ne: false },
      });

      const shiftList = Array.isArray(shifts) ? shifts : [];
      const shiftById = new Map();
      const shiftIds = [];
      for (const shift of shiftList) {
        if (shift && shift._id) {
          shiftById.set(String(shift._id), shift);
          shiftIds.push(shift._id);
        }
      }

      let workedTimes = [];
      if (shiftIds.length > 0) {
        workedTimes = await safeFind(WorkedTime, {
          organizationId,
          $or: [{ silShiftId: { $in: shiftIds } }, { shiftId: { $in: shiftIds } }],
          isActive: { $ne: false },
        });
      }

      const actualHoursBySupport = new Map();
      for (const wt of Array.isArray(workedTimes) ? workedTimes : []) {
        if (!wt || wt.isActive === false) continue;
        const shiftId = String(wt.silShiftId || wt.shiftId || '');
        const shift = shiftById.get(shiftId);
        const supportNum = resolveSupportNumber(wt, shift, roc.supports);
        let hours = parseWorkedHours(wt);

        // Milestone 2.3: Dynamic ratio cost splitting for shared SIL shifts
        // Participant Billable Hours = (Shift Duration × Staff Count) / Present Residents Count
        if (shift && hours > 0) {
          const presentResidentsCount = Number(shift.presentResidentsCount) || 1;
          const staffCount = Number(shift.staffCount || shift.requiredStaff) || 1;
          if (presentResidentsCount > 1 || staffCount > 1) {
            const split = silRatioService.calculateParticipantShare({
              shiftHours: hours,
              staffCount,
              presentResidentsCount,
              baseSupportItemNumber: supportNum,
            });
            hours = split.billableHoursPerParticipant;
          }
        }

        if (supportNum && hours > 0) {
          const current = actualHoursBySupport.get(supportNum) || 0;
          actualHoursBySupport.set(supportNum, round2(current + hours));
        }
      }

      if (mode === 'verified_timesheet') {
        for (const support of roc.supports || []) {
          const shiftType = String(support.shiftType || 'day').toLowerCase();
          const isSleepover = shiftType === 'sleepover';
          const supportNum = String(support.supportNumber || support.itemNumber || '').trim();
          const actualHours = round2(actualHoursBySupport.get(supportNum) || 0);
          if (actualHours <= 0) continue;

          const unitPrice = round2(support.unitPrice);
          const quantity = isSleepover
            ? Math.max(1, Math.round(actualHours / 8))
            : actualHours;
          const totalPrice = round2(quantity * unitPrice);
          subtotal = round2(subtotal + totalPrice);
          lineItems.push({
            supportItemNumber: support.supportNumber || support.itemNumber,
            supportItemName: support.supportName || support.itemName || 'SIL Support',
            price: unitPrice,
            quantity,
            unit: isSleepover ? 'E' : 'H',
            totalPrice,
            date: periodFrom,
            organizationId,
          });
        }
      } else if (mode === 'reconciled') {
        let totalPlannedHours = 0;
        let totalActualHours = 0;
        let totalVarianceHours = 0;

        // 1. Calculate standard planned line items (like roc_quota)
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

          const unitPrice = round2(support.unitPrice);
          const totalPrice = round2(quantity * unitPrice);
          subtotal = round2(subtotal + totalPrice);
          lineItems.push({
            supportItemNumber: support.supportNumber || support.itemNumber,
            supportItemName: support.supportName || support.itemName || 'SIL Support',
            price: unitPrice,
            quantity,
            unit: isSleepover ? 'E' : 'H',
            totalPrice,
            date: periodFrom,
            organizationId,
          });
        }

        // 2. Compare actual WorkedTime hours with planned hours and append variance line items
        for (const support of roc.supports || []) {
          const shiftType = String(support.shiftType || 'day').toLowerCase();
          const isSleepover = shiftType === 'sleepover';
          const daysPerWeek =
            Array.isArray(support.days) && support.days.length > 0
              ? support.days.length
              : 0;
          const plannedHours = isSleepover
            ? round2((Number(support.hoursPerWeek) || ((daysPerWeek || 1) * 8)) * weeks)
            : round2((Number(support.hoursPerWeek) || 0) * weeks);
          const supportNum = String(support.supportNumber || support.itemNumber || '').trim();
          const actualHours = round2(actualHoursBySupport.get(supportNum) || 0);

          totalPlannedHours = round2(totalPlannedHours + plannedHours);
          totalActualHours = round2(totalActualHours + actualHours);

          if (actualHours > plannedHours) {
            const varianceHours = round2(actualHours - plannedHours);
            totalVarianceHours = round2(totalVarianceHours + varianceHours);
            const unitPrice = round2(support.unitPrice);
            const varianceTotal = round2(varianceHours * unitPrice);
            subtotal = round2(subtotal + varianceTotal);

            lineItems.push({
              supportItemNumber: support.supportNumber || support.itemNumber,
              supportItemName: `${support.supportName || support.itemName || 'SIL Support'} (Unplanned / Variance Hours)`,
              price: unitPrice,
              quantity: varianceHours,
              unit: 'H',
              totalPrice: varianceTotal,
              date: periodFrom,
              organizationId,
            });
          }
        }

        silReconciliation = {
          plannedHours: totalPlannedHours,
          actualHours: totalActualHours,
          varianceHours: totalVarianceHours,
        };
      }
    } else {
      // mode: 'roc_quota' (default)
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

        const unitPrice = round2(support.unitPrice);
        const totalPrice = round2(quantity * unitPrice);
        subtotal = round2(subtotal + totalPrice);
        lineItems.push({
          supportItemNumber: support.supportNumber || support.itemNumber,
          supportItemName: support.supportName || support.itemName || 'SIL Support',
          price: unitPrice,
          quantity,
          unit: isSleepover ? 'E' : 'H',
          totalPrice,
          date: periodFrom,
          organizationId,
        });
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
      ? parseDateInput(opts.dueDate) || new Date(periodTo.getTime() + 30 * MS_PER_DAY)
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
        ...(roc.propertyId ? { silPropertyId: roc.propertyId } : {}),
        silPeriod: { from: periodFrom, to: periodTo },
        silBillingMode: mode,
        ...(silReconciliation ? { silReconciliation } : {}),
        ...(absenceDeductionsInfo ? { silAbsenceDeductions: absenceDeductionsInfo } : {}),
        internalNotes: `SIL roster of care ${roc._id} billed ${periodFrom
          .toISOString()
          .slice(0, 10)}..${periodTo.toISOString().slice(0, 10)}${
          unclaimableAbsenceDays > 0
            ? ` (${unclaimableAbsenceDays} unclaimable absence days deducted per NDIS hospital leave rules)`
            : ''
        }`,
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
module.exports.parseWorkedHours = parseWorkedHours;
module.exports.resolveSupportNumber = resolveSupportNumber;
module.exports.parseDateInput = parseDateInput;
