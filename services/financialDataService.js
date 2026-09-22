/**
 * Financial Data Primitives
 *
 * Real-data aggregates over Invoice/Expense collections backing the
 * Financial Intelligence dashboard endpoints. All functions are
 * deterministic: same data + same day => same numbers (no randomness).
 *
 * Money is rounded to 2 decimals at the boundary. Dates bucket in UTC.
 */
const { Invoice } = require('../models/Invoice');
const Expense = require('../models/Expense');

const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function startOfDayUtc(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/**
 * Parse '7d' | '30d' | '90d' | '12m' into current + previous windows.
 * Defaults to 30d on garbage input.
 */
function parsePeriod(period, now = new Date()) {
  const end = startOfDayUtc(now);
  end.setUTCDate(end.getUTCDate() + 1); // exclusive upper bound (start of tomorrow)
  let days = 30;
  const match = /^(\d+)\s*(d|day|m|month)?$/i.exec(String(period || '').trim());
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = (match[2] || 'd').toLowerCase();
    days = unit.startsWith('m') ? n * 30 : n;
  }
  if (!Number.isFinite(days) || days <= 0) days = 30;
  const start = new Date(end.getTime() - days * DAY_MS);
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  return { start, end, prevStart, prevEnd, days };
}

function changeRatio(current, previous) {
  if (!previous) return current > 0 ? 1 : 0;
  return (current - previous) / Math.abs(previous);
}

function trendOf(change) {
  if (change > 0.02) return 'up';
  if (change < -0.02) return 'down';
  return 'stable';
}

/** Base match for live (non-deleted, non-voided) invoices of an org. */
function liveInvoices(orgId) {
  return {
    organizationId: String(orgId),
    'deletion.isDeleted': { $ne: true },
    'workflow.status': { $nin: ['deleted', 'cancelled'] },
  };
}

/** Base match for live expenses of an org. */
function liveExpenses(orgId) {
  return {
    organizationId: String(orgId),
    isActive: true,
    deletedAt: null,
    status: { $nin: ['rejected', 'cancelled'] },
  };
}

/** Sum of paid invoice totals in [start, end). */
async function sumPaidInvoices(organizationId, start, end) {
  const rows = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        'payment.status': 'paid',
        $or: [{ 'payment.paidDate': { $gte: start, $lt: end } }],
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$financialSummary.totalAmount' },
        count: { $sum: 1 },
      },
    },
  ]);
  // Fallback: paid invoices missing paidDate count via updatedAt.
  const missing = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        'payment.status': 'paid',
        $or: [
          { 'payment.paidDate': { $exists: false } },
          { 'payment.paidDate': null },
        ],
        updatedAt: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$financialSummary.totalAmount' },
        count: { $sum: 1 },
      },
    },
  ]);
  const a = rows[0] || { total: 0, count: 0 };
  const b = missing[0] || { total: 0, count: 0 };
  return { total: round2(a.total + b.total), count: a.count + b.count };
}

/** Sum of expense amounts in [start, end) by expenseDate. */
async function sumExpenses(organizationId, start, end) {
  const rows = await Expense.aggregate([
    {
      $match: {
        ...liveExpenses(organizationId),
        expenseDate: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);
  const r = rows[0] || { total: 0, count: 0 };
  return { total: round2(r.total), count: r.count };
}

/** Outstanding receivables + overdue slice. */
async function receivables(organizationId, now = new Date()) {
  const rows = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        'payment.status': { $in: ['pending', 'partial', 'overdue'] },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $subtract: [
              '$financialSummary.totalAmount',
              { $ifNull: ['$payment.paidAmount', 0] },
            ],
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const overdue = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        $or: [
          { 'payment.status': 'overdue' },
          {
            'payment.status': { $in: ['pending', 'partial'] },
            'financialSummary.dueDate': { $lt: now },
          },
        ],
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $subtract: [
              '$financialSummary.totalAmount',
              { $ifNull: ['$payment.paidAmount', 0] },
            ],
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const r = rows[0] || { total: 0, count: 0 };
  const o = overdue[0] || { total: 0, count: 0 };
  return {
    total: round2(Math.max(0, r.total)),
    count: r.count,
    overdueTotal: round2(Math.max(0, o.total)),
    overdueCount: o.count,
  };
}

/** Unpaid expense obligations. */
async function payables(organizationId) {
  const rows = await Expense.aggregate([
    { $match: liveExpenses(organizationId) },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const r = rows[0] || { total: 0, count: 0 };
  return { total: round2(r.total), count: r.count };
}

/**
 * Daily inflows (paid invoices by paidDate) / outflows (expenses by
 * expenseDate) for the last `days` days, oldest first. Deterministic.
 */
async function dailyNetSeries(organizationId, days, now = new Date()) {
  const end = startOfDayUtc(now);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end.getTime() - days * DAY_MS);

  const inflowRows = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        'payment.status': 'paid',
        'payment.paidDate': { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$payment.paidDate' },
        },
        total: { $sum: '$financialSummary.totalAmount' },
      },
    },
  ]);
  const outflowRows = await Expense.aggregate([
    {
      $match: { ...liveExpenses(organizationId), expenseDate: { $gte: start, $lt: end } },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$expenseDate' } },
        total: { $sum: '$amount' },
      },
    },
  ]);

  const inMap = new Map(inflowRows.map((r) => [r._id, r.total]));
  const outMap = new Map(outflowRows.map((r) => [r._id, r.total]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - (i + 1) * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    series.push({
      date: key,
      inflows: round2(inMap.get(key) || 0),
      outflows: round2(outMap.get(key) || 0),
    });
  }
  return series;
}

/** Top clients by paid revenue in window. */
async function topClientsByRevenue(organizationId, start, end, limit = 5) {
  const rows = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        'payment.status': 'paid',
        'payment.paidDate': { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: '$clientId',
        revenue: { $sum: '$financialSummary.totalAmount' },
        name: { $first: '$clientName' },
        email: { $first: '$clientEmail' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);
  const total = rows.reduce((s, r) => s + (r.revenue || 0), 0) || 1;
  return rows.map((r) => ({
    clientId: r._id || 'unknown',
    clientName: r.name || r.email || 'Unknown client',
    revenue: round2(r.revenue),
    share: round2(r.revenue / total),
  }));
}

/** Monthly paid revenue for the last `months` calendar months. */
async function monthlyRevenue(organizationId, months, now = new Date()) {
  const end = startOfDayUtc(now);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  const rows = await Invoice.aggregate([
    {
      $match: {
        ...liveInvoices(organizationId),
        'payment.status': 'paid',
        'payment.paidDate': { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m', date: '$payment.paidDate' },
        },
        revenue: { $sum: '$financialSummary.totalAmount' },
      },
    },
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, r.revenue]));
  const out = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor < end && out.length < months) {
    const key = cursor.toISOString().slice(0, 7);
    out.push({ month: key, revenue: round2(byMonth.get(key) || 0) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

module.exports = {
  parsePeriod,
  changeRatio,
  trendOf,
  round2,
  sumPaidInvoices,
  sumExpenses,
  receivables,
  payables,
  dailyNetSeries,
  topClientsByRevenue,
  monthlyRevenue,
};
