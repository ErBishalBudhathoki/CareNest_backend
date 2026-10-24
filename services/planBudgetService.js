const Client = require('../models/Client');
const { Invoice } = require('../models/Invoice');

/**
 * NDIS plan-budget gate.
 *
 * An NDIA-managed invoice can only be claimed against an active plan with
 * enough remaining budget. This service is the single place that answers:
 *
 *   - does the participant have a plan?
 *   - is the service period inside it?
 *   - is there enough budget left after invoices already issued in the plan?
 *
 * A documented override may be supplied by an administrator; it is returned in
 * the validation result so the caller can persist it on the invoice audit trail.
 */

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNdiaManaged(fundingType) {
  const funding = String(fundingType || '').toLowerCase();
  return funding === 'ndia_managed' || funding === 'combination';
}

/** NDIS category is the two-digit prefix of the support item number. */
function categoryOf(line = {}) {
  const explicit =
    line.supportCategoryNumber || line.categoryNumber || line.category;
  if (explicit != null && String(explicit).trim() !== '') {
    const digits = String(explicit).replace(/\D/g, '');
    if (digits) return digits.slice(0, 2).padStart(2, '0');
  }
  const support =
    line.supportItemNumber ||
    line.ndisItemNumber ||
    line.itemCode ||
    line.supportNumber ||
    '';
  const match = String(support).match(/^(\d{2})_/);
  return match ? match[1] : '';
}

function lineAmount(line = {}) {
  const total = Number(line.totalPrice);
  if (Number.isFinite(total) && total !== 0) return total;
  const quantity = Number(line.quantity ?? line.hours ?? 0);
  const price = Number(line.price ?? line.unitPrice ?? line.rate ?? 0);
  return round2(quantity * price);
}

class PlanBudgetService {
  async getPlan(clientId, organizationId) {
    if (!clientId) return null;
    return Client.findOne({ _id: clientId, organizationId })
      .select('fundingType plan clientFirstName clientLastName')
      .lean();
  }
  /**
   * @param {Object} opts
   * @param {string} opts.organizationId
   * @param {string} opts.clientId
   * @param {number} opts.amount invoice total
   * @param {string|Date} [opts.serviceStart]
   * @param {string|Date} [opts.serviceEnd]
   * @param {string} [opts.invoiceType]
   * @param {boolean} [opts.allowOverride]
   * @param {string} [opts.overrideReason]
   * @param {string} [opts.excludeInvoiceId]
   * @returns {Promise<Object>} { ok, code?, message?, ...budget context }
   */
  async validateInvoiceAgainstPlan(opts = {}) {
    const {
      organizationId,
      clientId,
      invoiceType = 'client',
      allowOverride = false,
      overrideReason = '',
      excludeInvoiceId = null,
    } = opts;

    if (String(invoiceType).toLowerCase() === 'employee') {
      return { ok: true, skipped: true, reason: 'employee_invoice' };
    }
    if (!organizationId || !clientId) {
      return { ok: true, skipped: true, reason: 'client_not_linked' };
    }

    const client = await this.getPlan(clientId, organizationId);
    if (!client) {
      // Referential integrity is enforced elsewhere; do not invent a failure
      // here that would turn a bad clientId into a budget error.
      return { ok: true, skipped: true, reason: 'client_not_found' };
    }

    const plan = client.plan || {};
    const planStart = toDate(plan.startDate);
    const planEnd = toDate(plan.endDate);
    const totalBudget = Number(plan.totalBudget) || 0;
    const categoryBudgets = (Array.isArray(plan.categories) ? plan.categories : [])
      .map((category) => ({
        categoryNumber: String(category.categoryNumber || '').trim(),
        name: category.name || '',
        budget: Number(category.budget) || 0,
      }))
      .filter((category) => category.categoryNumber && category.budget > 0);
    const categoryBudgetTotal = round2(
      categoryBudgets.reduce((sum, category) => sum + category.budget, 0),
    );
    // A plan may be expressed as a single envelope, category envelopes, or
    // both. Categories are additive when no total was entered.
    const effectiveBudget = totalBudget > 0 ? totalBudget : categoryBudgetTotal;
    const hasPlan = Boolean(planStart && planEnd && effectiveBudget > 0);
    const ndiaManaged = isNdiaManaged(client.fundingType);

    const override = (code, message, extra = {}) => {
      if (!allowOverride) return { ok: false, code, message, ...extra };
      return {
        ok: true,
        overridden: true,
        code,
        message,
        overrideReason: overrideReason || 'No reason supplied',
        ...extra,
      };
    };

    if (!hasPlan) {
      if (!ndiaManaged) {
        return { ok: true, skipped: true, reason: 'plan_not_required' };
      }
      return override(
        'PLAN_REQUIRED',
        'This participant is NDIA-managed but has no NDIS plan budget configured. Add the plan period and budget before invoicing.',
      );
    }

    const serviceStart = toDate(opts.serviceStart) || new Date();
    const serviceEnd = toDate(opts.serviceEnd) || serviceStart;

    if (serviceStart < planStart || serviceEnd > planEnd) {
      return override(
        'OUTSIDE_PLAN_PERIOD',
        `Service period ${serviceStart.toISOString().slice(0, 10)} to ${serviceEnd
          .toISOString()
          .slice(0, 10)} falls outside the plan period ${planStart
          .toISOString()
          .slice(0, 10)} to ${planEnd.toISOString().slice(0, 10)}.`,
        { planStart, planEnd },
      );
    }

    const match = {
      organizationId: String(organizationId),
      clientId: String(clientId),
      'payment.status': { $nin: ['cancelled', 'credited', 'refunded'] },
      'deletion.isDeleted': { $ne: true },
      $or: [
        { createdAt: { $gte: planStart, $lte: planEnd } },
        { 'metadata.silPeriod.from': { $gte: planStart, $lte: planEnd } },
        { 'metadata.servicePeriod.from': { $gte: planStart, $lte: planEnd } },
      ],
    };
    if (excludeInvoiceId) {
      try {
        const mongoose = require('mongoose');
        match._id = { $ne: new mongoose.Types.ObjectId(excludeInvoiceId) };
      } catch (_) {
        // Ignore an invalid id; it can only make the consumed total safer.
      }
    }

    let consumed = 0;
    try {
      const rows = await Invoice.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: '$financialSummary.totalAmount' },
          },
        },
      ]);
      consumed = Number(rows?.[0]?.total) || 0;
    } catch (_) {
      // Fail closed: if spend cannot be calculated we must not claim.
      return override(
        'PLAN_BUDGET_UNAVAILABLE',
        'Could not calculate the remaining NDIS plan budget. Please retry.',
      );
    }

    const remaining = round2(effectiveBudget - consumed);
    const amount = round2(opts.amount);
    if (amount > remaining + 0.01) {
      return override(
        'INSUFFICIENT_PLAN_BUDGET',
        `Invoice amount $${amount.toFixed(2)} exceeds the remaining plan budget of $${remaining.toFixed(2)}.`,
        { totalBudget: round2(effectiveBudget), consumed: round2(consumed), remaining },
      );
    }

    // Category-level envelopes. This is checked before returning so an
    // invoice cannot hide an over-category line inside a healthy total.
    let categoryRemaining = null;
    const lineItems = Array.isArray(opts.lineItems) ? opts.lineItems : [];
    if (categoryBudgets.length > 0 && lineItems.length > 0) {
      try {
        const existingInvoices = await Invoice.find(match, { lineItems: 1 }).lean();
        const consumedByCategory = {};
        for (const invoice of existingInvoices || []) {
          for (const line of invoice.lineItems || []) {
            const category = categoryOf(line);
            if (!category) continue;
            consumedByCategory[category] =
              (consumedByCategory[category] || 0) + lineAmount(line);
          }
        }

        const requestedByCategory = {};
        for (const line of lineItems) {
          const category = categoryOf(line);
          if (!category) continue;
          requestedByCategory[category] =
            (requestedByCategory[category] || 0) + lineAmount(line);
        }

        const categoryFailures = [];
        categoryRemaining = {};
        for (const category of categoryBudgets) {
          const spent = round2(consumedByCategory[category.categoryNumber]);
          const requested = round2(requestedByCategory[category.categoryNumber]);
          const left = round2(category.budget - spent);
          categoryRemaining[category.categoryNumber] = round2(left - requested);
          if (requested > left + 0.01) {
            categoryFailures.push({
              categoryNumber: category.categoryNumber,
              name: category.name,
              budget: round2(category.budget),
              consumed: spent,
              requested,
              remaining: left,
            });
          }
        }

        if (categoryFailures.length > 0) {
          return override(
            'INSUFFICIENT_CATEGORY_BUDGET',
            `One or more NDIS support categories exceed their plan budget: ${categoryFailures
              .map((failure) => `${failure.categoryNumber} (remaining $${failure.remaining.toFixed(2)})`)
              .join(', ')}.`,
            {
              totalBudget: round2(effectiveBudget),
              consumed: round2(consumed),
              remaining: round2(remaining - amount),
              categoryFailures,
              categoryRemaining,
            },
          );
        }
      } catch (_) {
        return override(
          'PLAN_BUDGET_UNAVAILABLE',
          'Could not calculate the remaining NDIS category budgets. Please retry.',
        );
      }
    }

    return {
      ok: true,
      totalBudget: round2(effectiveBudget),
      consumed: round2(consumed),
      remaining: round2(remaining - amount),
      categoryRemaining,
      planStart,
      planEnd,
    };
  }
}

module.exports = new PlanBudgetService();
module.exports.isNdiaManaged = isNdiaManaged;
