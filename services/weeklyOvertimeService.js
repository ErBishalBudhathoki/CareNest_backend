/**
 * SCHADS weekly overtime.
 *
 * Daily overtime (handled by schadsService) and weekly overtime are separate
 * obligations. Hours that were already paid as daily overtime must not be
 * counted again here:
 *
 *   Full-time    38 ordinary hours per week
 *   Part-time    76 ordinary hours per 2-week cycle
 *   Casual      152 ordinary hours per 4-week cycle
 *
 * The excess ordinary hours are paid at 150% for the first 2 hours in the
 * cycle and 200% thereafter. Because the employee has already been paid for
 * those hours at their ordinary/penalty rate, this service returns only the
 * *premium* (difference) to add to gross pay. A premium is never negative:
 * Sunday hours already paid at 200% do not receive a weekly top-up.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const OVERTIME_CATEGORIES = new Set(['overtimeFirst2h', 'overtimeAfter2h']);
const EXCLUDED_FROM_WEEKLY_ORDINARY = new Set(['publicHoliday']);

function cycleWeeksFor(employmentType) {
  const type = String(employmentType || '').toLowerCase();
  if (type.includes('casual')) return 4;
  if (type.includes('part') || /(^|[_\s-])pt($|[_\s-])/.test(type)) return 2;
  return 1;
}

function sundayUtcOfWeek(value) {
  // ISO strings keep the service-local calendar date in their first 10
  // characters. Date objects are converted to the award timezone because
  // their UTC date can be the previous day.
  let day;
  if (value instanceof Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    day = `${map.year}-${map.month}-${map.day}`;
  } else {
    day = String(value || '').slice(0, 10);
  }
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const weekday = parsed.getUTCDay(); // 0 = Sunday
  const daysFromMonday = (weekday + 6) % 7;
  return parsed.getTime() - daysFromMonday * MS_PER_DAY;
}

function cycleKeyFor(startTime, weeks, anchorMs) {
  const mondayMs = sundayUtcOfWeek(startTime);
  if (mondayMs == null) return null;
  return Math.floor((mondayMs - anchorMs) / (weeks * MS_PER_WEEK));
}

/**
 * @param {Object} opts
 * @param {Array<{startTime:string|Date, segments:Array<{category:string,hours:number,rate:number}>}>} opts.shifts
 * @param {string} opts.employmentType
 * @param {Object} opts.multipliers resolved SCHADS multipliers
 * @param {number} opts.baseRate
 * @returns {{amount:number,hours:number,ot1Hours:number,ot2Hours:number,capHours:number,cycleWeeks:number}}
 */
function calculateWeeklyOvertime(opts = {}) {
  const shifts = Array.isArray(opts.shifts) ? opts.shifts : [];
  const multipliers = opts.multipliers || {};
  const baseRate = Number(opts.baseRate) || 0;
  const ot1Rate = baseRate * (multipliers.overtimeFirst2h || 1.5);
  const ot2Rate = baseRate * (multipliers.overtimeAfter2h || 2.0);

  const cycleWeeks = cycleWeeksFor(opts.employmentType);
  const capHours = 38 * cycleWeeks;

  // Anchor the averaging cycle to the first shift in the pay run (or an
  // explicit anchor supplied by the caller). A fixed calendar epoch would
  // make a 4-week casual cycle start mid-period and hide the excess hours.
  let anchorMs = opts.cycleAnchor ? sundayUtcOfWeek(opts.cycleAnchor) : null;
  if (anchorMs == null) {
    for (const shift of shifts) {
      const mondayMs = sundayUtcOfWeek(shift.startTime);
      if (mondayMs == null) continue;
      if (anchorMs == null || mondayMs < anchorMs) anchorMs = mondayMs;
    }
  }
  if (anchorMs == null) {
    return {
      amount: 0,
      hours: 0,
      ot1Hours: 0,
      ot2Hours: 0,
      capHours,
      cycleWeeks,
    };
  }

  const groups = new Map();
  for (const shift of shifts) {
    const key = cycleKeyFor(shift.startTime, cycleWeeks, anchorMs);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(shift);
  }

  let amount = 0;
  let hours = 0;
  let ot1Hours = 0;
  let ot2Hours = 0;

  for (const key of Array.from(groups.keys()).sort((a, b) => a - b)) {
    const group = groups.get(key).sort(
      (a, b) => new Date(a.startTime) - new Date(b.startTime),
    );

    let ordinaryHours = 0;
    let overtimeAllocated = 0;

    for (const shift of group) {
      const segments = Array.isArray(shift.segments) ? shift.segments : [];
      for (const segment of segments) {
        const segmentHours = Number(segment.hours) || 0;
        if (segmentHours <= 0) continue;
        if (OVERTIME_CATEGORIES.has(segment.category)) continue;
        if (EXCLUDED_FROM_WEEKLY_ORDINARY.has(segment.category)) continue;

        const before = ordinaryHours;
        ordinaryHours += segmentHours;
        if (ordinaryHours <= capHours) continue;

        // Only the portion of this segment that lies beyond the cap is
        // weekly overtime.
        const excessStart = Math.max(0, capHours - before);
        const excessHours = Math.max(0, segmentHours - excessStart);
        if (excessHours <= 0) continue;

        const ot1Remaining = Math.max(0, 2 - overtimeAllocated);
        const excessOt1 = Math.min(excessHours, ot1Remaining);
        const excessOt2 = excessHours - excessOt1;

        const paidRate = Number(segment.rate) || 0;
        const ot1Premium = Math.max(0, ot1Rate - paidRate) * excessOt1;
        const ot2Premium = Math.max(0, ot2Rate - paidRate) * excessOt2;

        amount += ot1Premium + ot2Premium;
        hours += excessHours;
        ot1Hours += excessOt1;
        ot2Hours += excessOt2;
        overtimeAllocated += excessHours;
      }
    }
  }

  return {
    amount: Math.round(amount * 100) / 100,
    hours: Math.round(hours * 100) / 100,
    ot1Hours: Math.round(ot1Hours * 100) / 100,
    ot2Hours: Math.round(ot2Hours * 100) / 100,
    capHours,
    cycleWeeks,
  };
}

module.exports = { calculateWeeklyOvertime, cycleWeeksFor };
