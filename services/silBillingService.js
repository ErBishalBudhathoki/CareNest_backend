const SILRosterOfCare = require('../models/SILRosterOfCare');
const Client = require('../models/Client');
const Shift = require('../models/Shift');
const WorkedTime = require('../models/WorkedTime');
const SILOccupancy = require('../models/SILOccupancy');
const SILProperty = require('../models/SILProperty');
const SupportItem = require('../models/SupportItem');
const silRatioService = require('./silRatioService');
const { mmmService } = require('./mmmService');
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

// Support item used for Irregular SIL / Crisis Staffing line items.
const CRISIS_SUPPORT_ITEM_NUMBER = '01_451_0107_1_1';
// Last-resort base rate used only when the RoC carries no priced support
// item AND the NDIS catalogue has no active price for the crisis item.
// Keeps invoice generation resilient; the catalogue lookup below is the
// authoritative source whenever available.
const CATALOG_FALLBACK_CRISIS_RATE = 65.47;

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

/**
 * Best-effort lookup of the active crisis support rate from the NDIS
 * catalogue (effective-dated, by delivery date). Returns the parsed price,
 * or null when the catalogue is unavailable or holds no active priced row.
 */
async function lookupCrisisSupportRate(asOf) {
  try {
    const effective = asOf ? new Date(asOf) : new Date();
    const item = await SupportItem.findOne({
      supportItemNumber: CRISIS_SUPPORT_ITEM_NUMBER,
      isActive: { $ne: false },
      startDate: { $lte: effective },
      $or: [{ endDate: null }, { endDate: { $gte: effective } }],
    })
      .sort({ startDate: -1 })
      .lean();
    const price = Number(item?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch (error) {
    logger.warn('NDIS catalogue crisis rate lookup failed; using fallback rate', {
      error: error.message,
    });
    return null;
  }
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
    // Milestone 7.1: Explicit idempotency token check for network retries and offline replay
    if (opts.idempotencyKey) {
      const existingByIdempotency = await Invoice.findOne({
        organizationId,
        'metadata.idempotencyKey': opts.idempotencyKey,
        'deletion.isDeleted': { $ne: true },
      });
      if (existingByIdempotency) {
        return {
          invoice: existingByIdempotency,
          billing: existingByIdempotency.billing || null,
          isIdempotentReplay: true,
        };
      }
    }

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
    let existing = null;
    const existingQuery = Invoice.findOne({
      organizationId,
      'metadata.silRosterOfCareId': roc._id,
      'metadata.silPeriod.from': periodFrom,
      'metadata.silPeriod.to': periodTo,
      'deletion.isDeleted': { $ne: true },
    });
    if (existingQuery && typeof existingQuery.select === 'function') {
      const sel = existingQuery.select('_id invoiceNumber');
      existing = sel && typeof sel.lean === 'function' ? await sel.lean() : await sel;
    } else {
      const resolved = await existingQuery;
      if (resolved && typeof resolved.select === 'function') {
        const sel = resolved.select('_id invoiceNumber');
        existing = sel && typeof sel.lean === 'function' ? await sel.lean() : await sel;
      } else if (resolved && typeof resolved.lean === 'function') {
        existing = await resolved.lean();
      } else {
        existing = resolved;
      }
    }

    if (existing) {
      if (opts.idempotencyKey) {
        return {
          invoice: existing,
          billing: existing.billing || null,
          isIdempotentReplay: true,
        };
      }
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

    // Milestone 4.1: Regional MMM Price Loading in SIL Billing
    // Look up property postcode (or client address postcode as fallback).
    // If MMM 6 (Remote) apply 1.4x multiplier; if MMM 7 (Very Remote) apply 1.5x multiplier.
    let servicePostcode = null;
    if (roc.propertyId) {
      try {
        const property = await safeFindOne(SILProperty, { _id: roc.propertyId, organizationId });
        servicePostcode = property?.address?.postcode || null;
      } catch (propErr) {
        logger.warn('Failed to query SILProperty for postcode during billing', {
          error: propErr.message,
          propertyId: String(roc.propertyId),
        });
      }
    }
    if (!servicePostcode && client) {
      servicePostcode = client.clientZip || client.address?.postcode || null;
    }

    let mmmRating = null;
    let mmmMultiplier = 1.0;
    if (servicePostcode) {
      try {
        const mmmInfo = await mmmService.getMmmByPostcode(servicePostcode);
        if (mmmInfo && typeof mmmInfo.mmm === 'number') {
          mmmRating = mmmInfo.mmm;
          mmmMultiplier = mmmService.getMultiplierForMmm(mmmRating);
        }
      } catch (mmmErr) {
        logger.warn('Failed to resolve MMM rating during SIL billing', {
          error: mmmErr.message,
          postcode: servicePostcode,
        });
      }
    }

    const lineItems = [];
    let subtotal = 0;
    let silReconciliation = null;
    let irregularSilEvents = [];

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

          // Milestone 4.1: Regional MMM Price Loading
          const baseUnitPrice = round2(support.unitPrice);
          const effectiveUnitPrice = mmmMultiplier > 1.0 ? round2(baseUnitPrice * mmmMultiplier) : baseUnitPrice;
          const quantity = isSleepover
            ? Math.max(1, Math.round(actualHours / 8))
            : actualHours;
          const totalPrice = round2(quantity * effectiveUnitPrice);
          subtotal = round2(subtotal + totalPrice);
          lineItems.push({
            supportItemNumber: support.supportNumber || support.itemNumber,
            supportItemName: support.supportName || support.itemName || 'SIL Support',
            price: effectiveUnitPrice,
            quantity,
            unit: isSleepover ? 'E' : 'H',
            totalPrice,
            date: periodFrom,
            organizationId,
            ...(servicePostcode ? { serviceLocationPostcode: servicePostcode } : {}),
            pricingMetadata: {
              mmmRating,
              mmmMultiplier,
              baseUnitPrice,
              appliedUnitPrice: effectiveUnitPrice,
            },
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

          // Milestone 4.1: Regional MMM Price Loading
          const baseUnitPrice = round2(support.unitPrice);
          const effectiveUnitPrice = mmmMultiplier > 1.0 ? round2(baseUnitPrice * mmmMultiplier) : baseUnitPrice;
          const totalPrice = round2(quantity * effectiveUnitPrice);
          subtotal = round2(subtotal + totalPrice);
          lineItems.push({
            supportItemNumber: support.supportNumber || support.itemNumber,
            supportItemName: support.supportName || support.itemName || 'SIL Support',
            price: effectiveUnitPrice,
            quantity,
            unit: isSleepover ? 'E' : 'H',
            totalPrice,
            date: periodFrom,
            organizationId,
            ...(servicePostcode ? { serviceLocationPostcode: servicePostcode } : {}),
            pricingMetadata: {
              mmmRating,
              mmmMultiplier,
              baseUnitPrice,
              appliedUnitPrice: effectiveUnitPrice,
            },
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
            // Milestone 4.1: Regional MMM Price Loading
            const baseUnitPrice = round2(support.unitPrice);
            const effectiveUnitPrice = mmmMultiplier > 1.0 ? round2(baseUnitPrice * mmmMultiplier) : baseUnitPrice;
            const varianceTotal = round2(varianceHours * effectiveUnitPrice);
            subtotal = round2(subtotal + varianceTotal);

            lineItems.push({
              supportItemNumber: support.supportNumber || support.itemNumber,
              supportItemName: `${support.supportName || support.itemName || 'SIL Support'} (Unplanned / Variance Hours)`,
              price: effectiveUnitPrice,
              quantity: varianceHours,
              unit: 'H',
              totalPrice: varianceTotal,
              date: periodFrom,
              organizationId,
              ...(servicePostcode ? { serviceLocationPostcode: servicePostcode } : {}),
              pricingMetadata: {
                mmmRating,
                mmmMultiplier,
                baseUnitPrice,
                appliedUnitPrice: effectiveUnitPrice,
              },
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

        // Milestone 4.1: Regional MMM Price Loading
        const baseUnitPrice = round2(support.unitPrice);
        const effectiveUnitPrice = mmmMultiplier > 1.0 ? round2(baseUnitPrice * mmmMultiplier) : baseUnitPrice;
        const totalPrice = round2(quantity * effectiveUnitPrice);
        subtotal = round2(subtotal + totalPrice);
        lineItems.push({
          supportItemNumber: support.supportNumber || support.itemNumber,
          supportItemName: support.supportName || support.itemName || 'SIL Support',
          price: effectiveUnitPrice,
          quantity,
          unit: isSleepover ? 'E' : 'H',
          totalPrice,
          date: periodFrom,
          organizationId,
          ...(servicePostcode ? { serviceLocationPostcode: servicePostcode } : {}),
          pricingMetadata: {
            mmmRating,
            mmmMultiplier,
            baseUnitPrice,
            appliedUnitPrice: effectiveUnitPrice,
          },
        });
      }
    }

    // Milestone 4.3: Irregular SIL, Crisis Staffing & PRN Support Billing
    // In timesheet/reconciliation billing, providers claim ad-hoc/unplanned crisis supports beyond agreed RoC quota
    // with mandatory NDIA PACE crisis justification notes and incident report references.
    if (mode === 'verified_timesheet' || mode === 'reconciled') {
      try {
        const irregularShifts = await safeFind(Shift, {
          organizationId,
          $or: [
            { silRosterOfCareId: roc._id, isIrregularSil: true },
            { clientId: roc.clientId, isIrregularSil: true },
          ],
          startTime: { $gte: periodFrom, $lt: periodEndExclusive },
          isActive: { $ne: false },
        });

        const irregularShiftList = Array.isArray(irregularShifts) ? irregularShifts : [];
        const irregularShiftIds = irregularShiftList.map((s) => s._id).filter(Boolean);

        let irregularWorkedTimes = [];
        if (irregularShiftIds.length > 0) {
          irregularWorkedTimes = await safeFind(WorkedTime, {
            organizationId,
            $or: [{ silShiftId: { $in: irregularShiftIds } }, { shiftId: { $in: irregularShiftIds } }],
            isActive: { $ne: false },
          });
        }

        const wtByIrregularShiftId = new Map();
        for (const wt of Array.isArray(irregularWorkedTimes) ? irregularWorkedTimes : []) {
          const sId = String(wt.silShiftId || wt.shiftId || '');
          if (sId) {
            if (!wtByIrregularShiftId.has(sId)) wtByIrregularShiftId.set(sId, []);
            wtByIrregularShiftId.get(sId).push(wt);
          }
        }

        // Crisis base rate priority: RoC daytime support price → active NDIS
        // catalogue price for the crisis item → named last-resort fallback.
        const rocCrisisRate = roc.supports && roc.supports.length > 0
          ? Number(roc.supports[0].unitPrice)
          : NaN;
        const baseCrisisRate =
          (Number.isFinite(rocCrisisRate) && rocCrisisRate > 0 && rocCrisisRate) ||
          (await lookupCrisisSupportRate(periodFrom)) ||
          CATALOG_FALLBACK_CRISIS_RATE;
        const effectiveCrisisRate = mmmMultiplier > 1.0 ? round2(baseCrisisRate * mmmMultiplier) : round2(baseCrisisRate);

        for (const irrShift of irregularShiftList) {
          if (!irrShift || irrShift.isIrregularSil !== true) continue;
          let shiftHours = 0;
          const associatedWts = wtByIrregularShiftId.get(String(irrShift._id)) || [];
          if (associatedWts.length > 0) {
            for (const wt of associatedWts) {
              shiftHours = round2(shiftHours + parseWorkedHours(wt));
            }
          } else if (irrShift.startTime && irrShift.endTime) {
            const start = new Date(irrShift.startTime).getTime();
            const end = new Date(irrShift.endTime).getTime();
            const breakMins = Number(irrShift.breakDuration) || 0;
            const grossHours = Math.max(0, (end - start) / (1000 * 60 * 60));
            shiftHours = round2(Math.max(0, grossHours - breakMins / 60));
          }

          if (shiftHours > 0) {
            const lineTotal = round2(shiftHours * effectiveCrisisRate);
            subtotal = round2(subtotal + lineTotal);

            const justification = irrShift.crisisJustificationNotes || irrShift.notes || 'NDIA PACE Crisis Support';
            const incidentRef = irrShift.incidentReportReference || '';
            const reason = irrShift.irregularSilReason || 'crisis';

            lineItems.push({
              supportItemNumber: CRISIS_SUPPORT_ITEM_NUMBER,
              supportItemName: `Irregular SIL / Crisis Staffing (${reason.toUpperCase()})`,
              price: effectiveCrisisRate,
              quantity: shiftHours,
              unit: 'H',
              totalPrice: lineTotal,
              date: irrShift.startTime ? new Date(irrShift.startTime) : periodFrom,
              organizationId,
              ...(servicePostcode ? { serviceLocationPostcode: servicePostcode } : {}),
              claimType: 'irregular_sil',
              pricingMetadata: {
                isIrregularSil: true,
                irregularSilReason: reason,
                crisisJustificationNotes: justification,
                incidentReportReference: incidentRef,
                mmmRating,
                mmmMultiplier,
                baseUnitPrice: baseCrisisRate,
                appliedUnitPrice: effectiveCrisisRate,
              },
            });

            irregularSilEvents.push({
              shiftId: String(irrShift._id),
              hours: shiftHours,
              reason,
              crisisJustificationNotes: justification,
              incidentReportReference: incidentRef,
              effectiveRate: effectiveCrisisRate,
              totalPrice: lineTotal,
            });
          }
        }
      } catch (irrErr) {
        logger.warn('Failed querying irregular SIL shifts during billing generation', {
          error: irrErr.message,
          rocId: String(roc._id),
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

    // Milestone 7.3: Resolve Plan Manager / Participant recipient details for automated dispatch
    const billingRoutingService = require('./billingRoutingService');
    const recipientDetails = await billingRoutingService.resolveBillingRecipient(client);
    const billingBlock = {
      ...billingRoutingService.buildInvoiceBilling(client),
      recipientDetails,
    };

    const invoiceData = {
      organizationId,
      invoiceNumber,
      clientId: String(roc.clientId),
      clientEmail,
      clientName,
      lineItems,
      // Milestone 7.3: Pre-stamped funding route and recipient contact details
      billing: billingBlock,
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
        // Milestone 7.1: Explicit idempotency token on invoice metadata
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        // Milestone 4.1: Regional MMM metadata on invoice
        ...(servicePostcode ? { serviceLocationPostcode: servicePostcode } : {}),
        ...(mmmRating !== null ? { mmmRating } : {}),
        ...(mmmMultiplier !== 1.0 ? { mmmMultiplier } : {}),
        // Milestone 4.3: Irregular SIL events on invoice
        ...(irregularSilEvents.length > 0 ? { irregularSilEvents } : {}),
        ...(silReconciliation ? { silReconciliation } : {}),
        ...(absenceDeductionsInfo ? { silAbsenceDeductions: absenceDeductionsInfo } : {}),
        internalNotes: `SIL roster of care ${roc._id} billed ${periodFrom
          .toISOString()
          .slice(0, 10)}..${periodTo.toISOString().slice(0, 10)}${
          unclaimableAbsenceDays > 0
            ? ` (${unclaimableAbsenceDays} unclaimable absence days deducted per NDIS hospital leave rules)`
            : ''
        }${mmmMultiplier > 1.0 ? ` (MMM ${mmmRating} regional multiplier: ${mmmMultiplier}x)` : ''}${
          irregularSilEvents.length > 0 ? ` (${irregularSilEvents.length} irregular SIL crisis events billed)` : ''
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

    let result;
    try {
      result = await invoiceManagementService.createInvoice(invoiceData);
    } catch (createErr) {
      if (createErr.code === 11000) {
        // Milestone 7.1: Concurrent race recovery on partial unique compound index sil_roc_period_unique or idempotencyKey
        const winningInvoice = await Invoice.findOne({
          organizationId,
          $or: [
            ...(opts.idempotencyKey ? [{ 'metadata.idempotencyKey': opts.idempotencyKey }] : []),
            {
              'metadata.silRosterOfCareId': roc._id,
              'metadata.silPeriod.from': periodFrom,
              'metadata.silPeriod.to': periodTo,
            },
          ],
          'deletion.isDeleted': { $ne: true },
        });
        if (winningInvoice) {
          return {
            invoice: winningInvoice,
            billing: winningInvoice.billing || null,
            isIdempotentReplay: true,
          };
        }
      }
      throw createErr;
    }

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

  /**
   * Milestone 7.3: Automated invoice dispatch workflow.
   * Dispatches the invoice to the participant or primary plan manager stakeholder,
   * stamps dispatch metadata, updates workflow status to 'sent', and sends email if configured.
   *
   * @param {string} organizationId
   * @param {string} invoiceId
   * @param {Object} opts - { actor, dispatchMethod, recipientEmail }
   * @returns {Promise<Object>}
   */
  async dispatchInvoice(organizationId, invoiceId, opts = {}) {
    const invoice = await Invoice.findOne({
      _id: invoiceId,
      organizationId,
      'deletion.isDeleted': { $ne: true },
    });
    if (!invoice) return { notFound: true };

    const client = await Client.findOne({ _id: invoice.clientId, organizationId }).lean();
    const billingRoutingService = require('./billingRoutingService');
    let recipient = invoice.billing?.recipientDetails;
    if (!recipient || !recipient.email) {
      recipient = await billingRoutingService.resolveBillingRecipient(client);
    }

    const targetEmail = opts.recipientEmail || recipient?.email || invoice.clientEmail || '';
    const dispatchMethod = opts.dispatchMethod || 'email';

    // Attempt sending email notification
    let emailSent = false;
    let emailError = null;
    if (targetEmail && dispatchMethod === 'email') {
      try {
        const emailService = require('./emailService');
        const subject = `Invoice ${invoice.invoiceNumber || invoice._id} for ${invoice.clientName || 'NDIS Participant'}`;
        const html = `
          <p>Dear ${recipient?.name || invoice.clientName || 'Recipient'},</p>
          <p>Please find attached the invoice <strong>${invoice.invoiceNumber}</strong> for the billing period 
          ${invoice.metadata?.silPeriod?.from ? new Date(invoice.metadata.silPeriod.from).toLocaleDateString() : ''} to 
          ${invoice.metadata?.silPeriod?.to ? new Date(invoice.metadata.silPeriod.to).toLocaleDateString() : ''}.</p>
          <p><strong>Total Amount:</strong> $${invoice.financialSummary?.totalAmount?.toFixed(2) || '0.00'}</p>
          <p>Thank you.</p>
        `;
        if (emailService && typeof emailService.sendEmail === 'function') {
          await emailService.sendEmail(targetEmail, subject, html);
          emailSent = true;
        }
      } catch (mailErr) {
        logger.warn('Email dispatch failed, recording dispatch status nonetheless', { error: mailErr.message });
        emailError = mailErr.message;
      }
    }

    // Update workflow status to 'sent'
    invoice.workflow = invoice.workflow || {};
    invoice.workflow.status = 'sent';
    invoice.workflow.currentStep = 'sent';
    invoice.workflow.nextAction = 'paid';

    invoice.billing = invoice.billing || {};
    invoice.billing.recipientDetails = {
      type: recipient?.type || 'participant',
      name: recipient?.name || invoice.clientName || '',
      email: targetEmail || '',
      company: recipient?.company || '',
      phone: recipient?.phone || '',
      stakeholderId: recipient?.stakeholderId || null,
      dispatchedAt: new Date(),
      dispatchedBy: opts.actor || 'system',
      dispatchMethod,
    };

    invoice.auditTrail = invoice.auditTrail || { changeHistory: [] };
    invoice.auditTrail.changeHistory.push({
      timestamp: new Date(),
      userId: opts.actor || 'system',
      action: 'dispatched',
      changes: { recipient: targetEmail, method: dispatchMethod },
      reason: `Invoice dispatched to ${recipient?.type || 'recipient'} (${targetEmail})`,
    });

    if (typeof invoice.save === 'function') {
      await invoice.save();
    } else if (typeof Invoice.updateOne === 'function') {
      await Invoice.updateOne({ _id: invoice._id }, invoice);
    }

    logger.business('SIL Invoice Dispatched', {
      event: 'sil_invoice_dispatched',
      organizationId,
      invoiceId: invoice._id.toString(),
      recipientEmail: targetEmail,
      recipientType: recipient?.type,
    });

    return {
      success: true,
      message: `Invoice dispatched to ${targetEmail || 'recipient'}.`,
      data: {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.workflow.status,
        recipientEmail: targetEmail,
        recipientType: recipient?.type,
        dispatchedAt: invoice.billing.recipientDetails.dispatchedAt,
        emailSent,
        emailError,
      },
    };
  }
}

module.exports = new SILBillingService();
module.exports.round2 = round2;
module.exports.inclusiveDays = inclusiveDays;
module.exports.parseWorkedHours = parseWorkedHours;
module.exports.resolveSupportNumber = resolveSupportNumber;
module.exports.parseDateInput = parseDateInput;
