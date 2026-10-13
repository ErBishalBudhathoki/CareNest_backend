/**
 * SCHADS Award rate table & multiplier configuration.
 *
 * Design intent (see docs/NDIS_DEPTH_ROADMAP.md §1.5):
 *   Award rates change annually/quarterly. Rates and multipliers are therefore
 *   DATA, not code. This module is the single source of truth for the SCHADS
 *   pay tables and penalty/loading multipliers. The engine (schadsService.js)
 *   consumes it and never hard-codes a dollar figure.
 *
 * Effective dating: each table carries an `effectiveFrom` ISO date. Lookups
 * resolve the latest table whose `effectiveFrom <= serviceDate`, so historical
 * payslips do not change when a new table is added.
 *
 * IMPORTANT: The values here are illustrative defaults for the SCHADS Award
 * (MA000100). They MUST be verified against the current Fair Work / NDIS price
 * guide before production use. Treat this as a seeded starting point, not
 * legal advice.
 */

const SCHADS_AWARD_CODE = 'MA000100';

/**
 * Base hourly rates by SCHADS level (1-5) and employee stream.
 * These are the PERMANENT base rates; casual loading is applied separately.
 */
const RATE_TABLES = [
  {
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2025-07-01',
    // Hourly rates stored directly for engine simplicity.
    hourly: {
      home_care: { 1: 24.1, 2: 25.8, 3: 27.1, 4: 28.55, 5: 30.1 },
      disability: { 1: 24.1, 2: 25.8, 3: 27.0, 4: 28.55, 5: 30.1 },
      social_community: { 1: 24.36, 2: 26.08, 3: 27.39, 4: 28.86, 5: 30.43 },
    },
    // Progression between pay points within a level (e.g. "1.3" -> 2 steps).
    payPointStep: 0.03,
  },
];

/**
 * Penalty and loading multipliers. Keyed by award code, effective-dated.
 * Multipliers apply to the resolved base hourly rate.
 */
const MULTIPLIER_TABLES = [
  {
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2025-07-01',
    multipliers: {
      base: 1.0,
      // Shift loadings (weekday)
      afternoon: 1.125, // 12.5% loading
      night: 1.15, // 15% loading
      // Weekend
      saturday: 1.5, // 150%
      sunday: 1.75, // 175%
      // Public holiday
      publicHoliday: 2.5, // 250%
      // Overtime (first 2h, thereafter)
      overtimeFirst2h: 1.5,
      overtimeAfter2h: 2.0,
    },
    // Casual loading applies ON TOP of base ordinary rates.
    casualLoading: 0.25, // 25%
  },
];

const DEFAULTS = {
  timezone: 'Australia/Sydney',
  standardHoursPerDay: 8,
  firstAidAllowance: 1.5, // flat $ per shift
  mealAllowance: 16.0, // flat $ per shift when eligible
  sleepoverAllowance: 65.5, // flat $ per sleepover shift
};

/**
 * Return the latest table whose `effectiveFrom <= date`.
 * Falls back to the earliest table when the date precedes all tables so the
 * engine stays deterministic.
 */
function _latestEffective(tables, date) {
  const target = date ? new Date(date) : new Date();
  let chosen = null;
  for (const t of tables) {
    if (new Date(t.effectiveFrom) <= target) {
      if (!chosen || new Date(t.effectiveFrom) > new Date(chosen.effectiveFrom)) {
        chosen = t;
      }
    }
  }
  return chosen || tables[0];
}

/**
 * Resolve the penalty/loading multipliers in effect for a date.
 * @param {string} awardCode
 * @param {Date|string} [date]
 * @returns {Object} multipliers plus `casualLoading`
 */
function resolveMultipliers(awardCode = SCHADS_AWARD_CODE, date) {
  const tables = MULTIPLIER_TABLES.filter((t) => t.awardCode === awardCode);
  const pool = tables.length ? tables : MULTIPLIER_TABLES;
  const chosen = _latestEffective(pool, date);
  return { ...chosen.multipliers, casualLoading: chosen.casualLoading };
}

/**
 * Resolve base hourly rate for a stream/level/payPoint on a date.
 * @param {Object} opts
 * @param {string} [opts.awardCode]
 * @param {string} [opts.stream]
 * @param {number} [opts.level]
 * @param {string} [opts.payPoint]
 * @param {Date|string} [opts.date]
 * @param {number} [opts.payRateFallback] legacy User.payRate when no table matches
 * @returns {number} hourly base rate
 */
function resolveBaseRate(opts = {}) {
  const {
    awardCode = SCHADS_AWARD_CODE,
    stream = 'disability',
    level,
    payPoint,
    date,
    payRateFallback,
  } = opts;

  const tables = RATE_TABLES.filter((t) => t.awardCode === awardCode);
  const table = _latestEffective(tables.length ? tables : RATE_TABLES, date);

  const streamRates = table.hourly[stream] || table.hourly.disability;
  let rate = level != null ? streamRates[level] : undefined;
  if (rate == null) {
    rate = streamRates[2];
  }
  if (rate == null) {
    rate = payRateFallback || 0;
  }

  // Apply payPoint progression (e.g. "1.3" -> 2 steps above level base).
  if (payPoint) {
    const step = parseInt(String(payPoint).split('.')[1], 10);
    if (!Number.isNaN(step) && step > 0) {
      rate += rate * table.payPointStep * step;
    }
  }

  return parseFloat(rate.toFixed(4));
}

/**
 * Resolve flat allowances.
 */
function resolveAllowances() {
  return { ...DEFAULTS };
}

module.exports = {
  SCHADS_AWARD_CODE,
  DEFAULTS,
  RATE_TABLES,
  MULTIPLIER_TABLES,
  resolveMultipliers,
  resolveBaseRate,
  resolveAllowances,
};
