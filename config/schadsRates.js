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
 * Base hourly rates by SCHADS classification, level and pay point.
 * These are the PERMANENT base rates; casual loading is applied separately.
 */
const RATE_TABLES = [
  {
    // Source: Fair Work Ombudsman Pay Guide MA000100, published 04/09/2025,
    // effective the first full pay period on or after 01/10/2025. These are
    // the rates that applied until the 2026-27 table took effect.
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2025-10-01',
    hourly: {
      social_community: {
        '1.1': 26.30,
        '1.2': 27.15,
        '1.3': 28.12,
        '2.1': 34.58,
        '2.2': 35.67,
        '2.3': 36.75,
        '2.4': 37.73,
        '3.1': 38.65,
        '3.2': 39.77,
        '3.3': 40.62,
        '3.4': 41.45,
        '4.1': 44.58,
        '4.2': 45.75,
        '4.3': 46.93,
        '4.4': 47.97,
        '5.1': 51.00,
        '5.2': 52.10,
        '5.3': 53.31,
        '6.1': 55.72,
        '6.2': 56.95,
        '6.3': 58.19,
        '7.1': 60.27,
        '7.2': 61.53,
        '7.3': 62.79,
        '8.1': 65.39,
        '8.2': 66.67,
        '8.3': 67.96,
      },
      // Home care employee — Disability care.
      disability: {
        '1.1': 26.05,
        '2.1': 27.55,
        '2.2': 27.74,
        '3.1': 28.12,
        '3.2': 28.98,
        '4.1': 30.67,
        '4.2': 31.29,
        '5.1': 32.89,
        '5.2': 34.19,
      },
      // Home care employee — Aged care.
      home_care: {
        1: 31.13,
        2: 32.86,
        3: 34.59,
        4: 35.97,
        5: 37.35,
        6: 38.74,
      },
      aged_care: {
        1: 31.13,
        2: 32.86,
        3: 34.59,
        4: 35.97,
        5: 37.35,
        6: 38.74,
      },
    },
    payPointStep: 0,
  },
  {
    // Source: Fair Work Ombudsman Pay Guide MA000100, published 18/09/2026.
    // The published effective date is 01/12/2026; the product decision is to
    // apply these latest figures from the start of the 2026-27 award year so
    // October/November payroll does not use the superseded 2025 table.
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2026-07-01',
    hourly: {
      social_community: {
        '1.1': 27.55,
        '1.2': 28.44,
        '1.3': 29.45,
        '2.1': 36.22,
        '2.2': 37.36,
        '2.3': 38.50,
        '2.4': 39.53,
        '3.1': 40.49,
        '3.2': 41.66,
        '3.3': 42.55,
        '3.4': 43.42,
        '4.1': 46.70,
        '4.2': 47.92,
        '4.3': 49.16,
        '4.4': 50.25,
        '5.1': 53.43,
        '5.2': 54.58,
        '5.3': 55.85,
        '6.1': 58.37,
        '6.2': 59.66,
        '6.3': 60.95,
        '7.1': 63.13,
        '7.2': 64.46,
        '7.3': 65.77,
        '8.1': 68.49,
        '8.2': 69.84,
        '8.3': 71.19,
      },
      // Home care employee — Disability care.
      disability: {
        '1.1': 31.38,
        '2.1': 33.19,
        '2.2': 33.41,
        '3.1': 33.87,
        '3.2': 34.92,
        '4.1': 36.95,
        '4.2': 37.68,
        '5.1': 39.62,
        '5.2': 40.58,
      },
      // Home care employee — Aged care.
      home_care: {
        1: 32.61,
        2: 34.42,
        3: 36.23,
        4: 37.68,
        5: 39.13,
        6: 40.58,
      },
      aged_care: {
        1: 32.61,
        2: 34.42,
        3: 36.23,
        4: 37.68,
        5: 39.13,
        6: 40.58,
      },
    },
    payPointStep: 0,
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
      sunday: 2.0, // 200% (casual: 225% via additive casual loading)
      // Public holiday
      publicHoliday: 2.5, // 250%
      // Overtime (first 2h, thereafter)
      overtimeFirst2h: 1.5,
      overtimeAfter2h: 2.0,
    },
    // Casual loading applies ON TOP of base ordinary rates.
    casualLoading: 0.25, // 25%
  },
  {
    // Source: Pay Guide MA000100 effective 01/12/2026. Penalty percentages
    // are unchanged (Saturday 150%, Sunday 200%, PH 250%, afternoon 12.5%,
    // night 15%; casual loading 25% additive).
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2026-12-01',
    multipliers: {
      base: 1.0,
      afternoon: 1.125,
      night: 1.15,
      saturday: 1.5,
      sunday: 2.0,
      publicHoliday: 2.5,
      overtimeFirst2h: 1.5,
      overtimeAfter2h: 2.0,
    },
    casualLoading: 0.25,
  },
];

/**
 * Flat shift allowances, effective-dated like the rate tables. Amounts are
 * data, not code: add a new table with the date the change takes effect rather
 * than editing an old one, so historical payslips never change.
 */
const ALLOWANCE_TABLES = [
  {
    // Source: Pay Guide MA000100 published 04/09/2025, effective on/after
    // 01/10/2025.
    //   First aid: $20.46/week full-time; $0.54/hour part-time/casual, capped
    //              at $20.46/week.
    //   Meal:     $16.62 when overtime is worked.
    //   Sleepover: $60.02 per sleepover.
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2025-10-01',
    allowances: {
      firstAidAllowance: 20.46,
      firstAidHourly: 0.54,
      firstAidMaxWeekly: 20.46,
      mealAllowance: 16.62,
      sleepoverAllowance: 60.02,
    },
  },
  {
    // Source: Pay Guide MA000100, published 18/09/2026. Published effective
    // date 01/12/2026; applied from 2026-07-01 per the same product decision
    // as the 2026-27 rate table.
    //   First aid: $21.43/week full-time; $0.56/hour part-time/casual, capped
    //              at $21.43/week.
    //   Meal:     $17.30 when overtime is worked; a further $17.30 after more
    //              than 4 hours of overtime.
    //   Sleepover: $62.87 per sleepover.
    awardCode: SCHADS_AWARD_CODE,
    effectiveFrom: '2026-07-01',
    allowances: {
      firstAidAllowance: 21.43,
      firstAidHourly: 0.56,
      firstAidMaxWeekly: 21.43,
      mealAllowance: 17.3,
      mealAdditionalAfter4hOvertime: 17.3,
      sleepoverAllowance: 62.87,
    },
  },
];

const DEFAULTS = {
  timezone: 'Australia/Sydney',
  standardHoursPerDay: 8,
};

/**
 * Return the calendar date in the award timezone as YYYY-MM-DD.
 * Effective dates are date-only, so comparing instants would make the 1
 * December table start at 10:00/11:00 local time instead of midnight.
 */
function _dateKeyInAwardTz(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULTS.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Return the latest table whose `effectiveFrom <= date`.
 * Falls back to the earliest table when the date precedes all tables so the
 * engine stays deterministic.
 */
function _latestEffective(tables, date) {
  const targetKey = date ? _dateKeyInAwardTz(date) : _dateKeyInAwardTz(new Date());
  let chosen = null;
  for (const t of tables) {
    if (!targetKey || t.effectiveFrom <= targetKey) {
      if (!chosen || t.effectiveFrom > chosen.effectiveFrom) {
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
  const levelKey = level != null ? String(level) : null;
  const payPointKey = payPoint != null ? String(payPoint) : null;

  let rate;
  let usedExplicitPayPoint = false;
  if (levelKey) {
    if (payPointKey) {
      // Pay points may be supplied as a full key ("2.2") or as a step ("2").
      const candidates = payPointKey.includes('.')
        ? [payPointKey, `${levelKey}.${payPointKey}`]
        : [`${levelKey}.${payPointKey}`, payPointKey];
      for (const key of candidates) {
        if (streamRates[key] != null) {
          rate = streamRates[key];
          usedExplicitPayPoint = true;
          break;
        }
      }
    }
    if (rate == null) rate = streamRates[`${levelKey}.1`];
    if (rate == null) rate = streamRates[levelKey];
  }
  if (rate == null) {
    rate = streamRates['2.1'] ?? streamRates[2] ?? payRateFallback ?? 0;
  }
  rate = Number(rate) || 0;

  // Legacy tables express pay points as a percentage step rather than
  // explicit rates. Apply it only when no explicit rate was found.
  if (!usedExplicitPayPoint && payPoint && table.payPointStep) {
    const step = parseInt(String(payPoint).split('.')[1], 10);
    if (!Number.isNaN(step) && step > 0) {
      rate += rate * table.payPointStep * step;
    }
  }

  return parseFloat(rate.toFixed(4));
}

/**
 * Resolve flat allowances in effect for a date.
 * @param {string} [awardCode]
 * @param {Date|string} [date]
 * @returns {{firstAidAllowance:number, mealAllowance:number, sleepoverAllowance:number, effectiveFrom:string}}
 */
function resolveAllowances(awardCode = SCHADS_AWARD_CODE, date) {
  const tables = ALLOWANCE_TABLES.filter((t) => t.awardCode === awardCode);
  const chosen = _latestEffective(tables.length ? tables : ALLOWANCE_TABLES, date);
  return {
    ...chosen.allowances,
    effectiveFrom: chosen.effectiveFrom,
  };
}

module.exports = {
  SCHADS_AWARD_CODE,
  DEFAULTS,
  RATE_TABLES,
  MULTIPLIER_TABLES,
  ALLOWANCE_TABLES,
  resolveMultipliers,
  resolveBaseRate,
  resolveAllowances,
};
