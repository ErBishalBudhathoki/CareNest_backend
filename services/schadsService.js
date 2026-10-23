/**
 * SCHADS shift breakdown engine - time-segmented.
 *
 * Replaces the previous whole-shift, start-day-only approximation.
 * See docs/NDIS_DEPTH_ROADMAP.md section 1.2 for the evidence.
 *
 * The engine splits a shift at every rate boundary:
 *   - clock boundaries: 0600 (night->day), 2000 (day->afternoon), 2400
 *   - calendar: weekday->Saturday, Saturday->Sunday, Sunday->weekday
 *   - public-holiday entry/exit
 *   - overtime threshold (after standardHoursPerDay of ordinary work)
 *
 * All boundary arithmetic is performed on absolute instants (UTC ms) and only
 * formatted/compared in the target IANA timezone, so DST folds and jumps do
 * not double-count or shift hours.
 *
 * Backward compatibility: calculateShiftBreakdown keeps the flat aggregate
 * keys (baseHours, afternoonShiftHours, ... totalHours) that
 * payrollService.calculateEmployeePayroll already consumes, and adds a new
 * additive segments array.
 */

const schadsRates = require('../config/schadsRates');
const logger = require('../config/logger');

const MS_PER_MIN = 60 * 1000;

const CATEGORIES = {
  BASE: 'base',
  AFTERNOON: 'afternoon',
  NIGHT: 'night',
  SATURDAY: 'saturday',
  SUNDAY: 'sunday',
  PUBLIC_HOLIDAY: 'publicHoliday',
  OVERTIME_1: 'overtimeFirst2h',
  OVERTIME_AFTER: 'overtimeAfter2h',
};

const HOURS_KEY = {
  [CATEGORIES.BASE]: 'baseHours',
  [CATEGORIES.AFTERNOON]: 'afternoonShiftHours',
  [CATEGORIES.NIGHT]: 'nightShiftHours',
  [CATEGORIES.SATURDAY]: 'saturdayHours',
  [CATEGORIES.SUNDAY]: 'sundayHours',
  [CATEGORIES.PUBLIC_HOLIDAY]: 'publicHolidayHours',
  [CATEGORIES.OVERTIME_1]: 'overtimeFirst2h',
  [CATEGORIES.OVERTIME_AFTER]: 'overtimeAfter2h',
};

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getZonedParts(date, timeZone) {
  const fmt = Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  return {
    year,
    month,
    day,
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    weekday: WEEKDAY_MAP[parts.weekday],
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function getOffsetMinutes(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUTC - date.getTime()) / MS_PER_MIN);
}

function zonedWallClockToUtc(year, month, day, hour, minute, timeZone) {
  const guessUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getOffsetMinutes(new Date(guessUTC), timeZone);
  let candidate = guessUTC - offset1 * MS_PER_MIN;
  const offset2 = getOffsetMinutes(new Date(candidate), timeZone);
  if (offset2 !== offset1) {
    candidate = guessUTC - offset2 * MS_PER_MIN;
  }
  return new Date(candidate);
}

function startOfZonedDay(parts, timeZone) {
  return zonedWallClockToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
}

function buildBoundaries(start, end, timeZone) {
  const boundaries = [start.getTime()];
  const startMs = start.getTime();
  const endMs = end.getTime();
  boundaries.push(endMs);

  let dayStartInstant = startOfZonedDay(getZonedParts(start, timeZone), timeZone);
  let guard = 0;
  while (dayStartInstant.getTime() <= endMs && guard < 1000) {
    guard += 1;
    const dp = getZonedParts(dayStartInstant, timeZone);
    for (const h of [0, 6, 20]) {
      const b = zonedWallClockToUtc(dp.year, dp.month, dp.day, h, 0, timeZone);
      const t = b.getTime();
      if (t > startMs && t < endMs) boundaries.push(t);
    }
    const nextDay = new Date(dayStartInstant.getTime() + 24 * 60 * MS_PER_MIN);
    dayStartInstant = startOfZonedDay(getZonedParts(nextDay, timeZone), timeZone);
  }

  return Array.from(new Set(boundaries)).sort((a, b) => a - b);
}

/**
 * Classify a segment.
 *
 * SCHADS loading windows (time-segmented interpretation):
 *   - 00:00–06:00                -> night
 *   - 06:00–20:00                -> base (day)
 *   - 20:00–24:00, shift does
 *     NOT cross midnight         -> afternoon
 *   - 20:00–24:00, shift DOES
 *     cross midnight             -> night (part of a night shift)
 *
 * The midnight-crossing distinction matters because SCHADS defines a night
 * shift as one that finishes after midnight (or starts before 06:00). The
 * pre-midnight portion of such a shift therefore also attracts night loading.
 *
 * @param {Date} segStart
 * @param {Date} segEnd
 * @param {string} timeZone
 * @param {Set<string>} holidaySet
 * @param {boolean} crossesMidnight
 */
function classifySegment(segStart, segEnd, timeZone, holidaySet, crossesMidnight) {
  const p = getZonedParts(segStart, timeZone);
  if (holidaySet.has(p.dateKey)) return CATEGORIES.PUBLIC_HOLIDAY;
  if (p.weekday === 0) return CATEGORIES.SUNDAY;
  if (p.weekday === 6) return CATEGORIES.SATURDAY;

  const startMinuteOfDay = p.hour * 60 + p.minute;

  // Early morning is always night.
  if (startMinuteOfDay < 6 * 60) return CATEGORIES.NIGHT;

  // Evening window: afternoon unless the shift is a night shift (crosses
  // midnight), in which case the whole pre-midnight evening is night.
  if (startMinuteOfDay >= 20 * 60) {
    return crossesMidnight ? CATEGORIES.NIGHT : CATEGORIES.AFTERNOON;
  }

  return CATEGORIES.BASE;
}

function zeroAggregates() {
  const agg = {};
  for (const key of Object.values(HOURS_KEY)) {
    agg[key] = 0;
  }
  agg.totalHours = 0;
  return agg;
}

function aggregateSegments(segments) {
  const agg = zeroAggregates();
  let totalMinutes = 0;
  for (const seg of segments) {
    const hours = seg.minutes / 60;
    totalMinutes += seg.minutes;
    const key = HOURS_KEY[seg.category];
    if (key) agg[key] += hours;
  }
  for (const k of Object.keys(agg)) {
    agg[k] = parseFloat(agg[k].toFixed(2));
  }
  agg.totalHours = parseFloat((totalMinutes / 60).toFixed(2));
  return agg;
}

function segmentShift(shift, config = {}) {
  const timezone = config.timezone || schadsRates.DEFAULTS.timezone;
  const holidaySet = config.holidaySet || new Set();
  const standardHoursPerDay =
    config.standardHoursPerDay || schadsRates.DEFAULTS.standardHoursPerDay;

  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  const breakMins = shift.breakDuration || 0;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { segments: [], aggregates: zeroAggregates() };
  }

  const boundaries = buildBoundaries(start, end, timezone);
  const baseSegments = [];

  // A night shift is defined (SCHADS) as one that finishes after midnight. If
  // the shift spans more than one zoned calendar day, its evening hours are
  // night rather than afternoon.
  const startDateKey = getZonedParts(start, timezone).dateKey;
  const endDateKey = getZonedParts(new Date(end.getTime() - 1), timezone).dateKey;
  const crossesMidnight = startDateKey !== endDateKey;

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const segStart = new Date(boundaries[i]);
    const segEnd = new Date(boundaries[i + 1]);
    const minutes = Math.round((segEnd.getTime() - segStart.getTime()) / MS_PER_MIN);
    if (minutes <= 0) continue;
    baseSegments.push({
      from: segStart.toISOString(),
      to: segEnd.toISOString(),
      minutes,
      category: classifySegment(segStart, segEnd, timezone, holidaySet, crossesMidnight),
    });
  }

  let breakRemaining = breakMins;
  for (const seg of baseSegments) {
    if (breakRemaining <= 0) break;
    const take = Math.min(seg.minutes, breakRemaining);
    seg.minutes -= take;
    breakRemaining -= take;
  }

  const standardMinutes = standardHoursPerDay * 60;
  let ordinaryAccumulated = 0;
  let overtimeAccumulated = 0;
  const segments = [];

  for (const seg of baseSegments) {
    if (seg.minutes <= 0) continue;
    if (seg.category === CATEGORIES.PUBLIC_HOLIDAY) {
      segments.push({ ...seg });
      continue;
    }
    let remaining = seg.minutes;
    while (remaining > 0) {
      // Ordinary hours first, up to the daily threshold.
      if (ordinaryAccumulated < standardMinutes) {
        const take = Math.min(remaining, standardMinutes - ordinaryAccumulated);
        segments.push({ ...seg, minutes: take });
        ordinaryAccumulated += take;
        remaining -= take;
        continue;
      }
      // Overtime: first 2h at tier 1, thereafter tier 2.
      const ot1Remaining = Math.max(0, 2 * 60 - overtimeAccumulated);
      if (ot1Remaining > 0) {
        const take = Math.min(remaining, ot1Remaining);
        segments.push({ ...seg, minutes: take, category: CATEGORIES.OVERTIME_1 });
        overtimeAccumulated += take;
        remaining -= take;
        continue;
      }
      segments.push({ ...seg, minutes: remaining, category: CATEGORIES.OVERTIME_AFTER });
      overtimeAccumulated += remaining;
      remaining = 0;
    }
  }

  return { segments, aggregates: aggregateSegments(segments) };
}

class SCHADSService {
  calculateShiftBreakdown(shift, config = {}) {
    try {
      const { segments, aggregates } = segmentShift(shift, config);
      return { ...aggregates, segments };
    } catch (error) {
      logger.error('SCHADS calculateShiftBreakdown failed', error);
      return { ...zeroAggregates(), segments: [] };
    }
  }

  segmentShift(shift, config = {}) {
    return segmentShift(shift, config);
  }

  calculateShiftAmount(shift, profile = {}) {
    const { segments, aggregates } = segmentShift(shift, {
      timezone: profile.timezone,
      holidaySet: profile.holidaySet,
      standardHoursPerDay: profile.standardHoursPerDay,
    });

    const baseRate = profile.baseRate || 0;
    const mult = profile.multipliers || schadsRates.resolveMultipliers();
    const casualLoading = profile.isCasual ? mult.casualLoading || 0 : 0;
    // SCHADS casual rates add the 25% loading to the *penalty percentage*
    // (e.g. Saturday 150% -> 175%, Sunday 200% -> 225%, PH 250% -> 275%).
    // Applying it multiplicatively produced 187.5% / 250% / 312.5%, which
    // disagreed with the rate editor and the legacy payroll table.
    const penaltyRate = (penalty) => baseRate * ((penalty || 1) + casualLoading);

    // Legacy mode: `categoryRates` supplies fully-resolved dollar rates per
    // category (already including casual loading / penalties). When present we
    // use them directly to avoid double-loading.
    const categoryRates = profile.categoryRates || null;

    const rateFor = (category) => {
      if (categoryRates) {
        const direct = categoryRates[category];
        if (direct != null && direct > 0) return direct;
      }
      switch (category) {
        case CATEGORIES.AFTERNOON:
          return penaltyRate(mult.afternoon);
        case CATEGORIES.NIGHT:
          return penaltyRate(mult.night);
        case CATEGORIES.SATURDAY:
          return penaltyRate(mult.saturday);
        case CATEGORIES.SUNDAY:
          return penaltyRate(mult.sunday);
        case CATEGORIES.PUBLIC_HOLIDAY:
          return penaltyRate(mult.publicHoliday);
        case CATEGORIES.OVERTIME_1:
          return baseRate * (mult.overtimeFirst2h || 1.5);
        case CATEGORIES.OVERTIME_AFTER:
          return baseRate * (mult.overtimeAfter2h || 2.0);
        case CATEGORIES.BASE:
        default:
          return baseRate * (mult.base || 1) * (1 + casualLoading);
      }
    };

    const byCategory = {};
    let gross = 0;
    for (const seg of segments) {
      const hours = seg.minutes / 60;
      const rate = rateFor(seg.category);
      const amt = hours * rate;
      byCategory[seg.category] = (byCategory[seg.category] || 0) + amt;
      gross += amt;
    }
    for (const k of Object.keys(byCategory)) {
      byCategory[k] = parseFloat(byCategory[k].toFixed(2));
    }

    return {
      segments,
      aggregates,
      amount: {
        baseRate,
        hours: aggregates.totalHours,
        byCategory,
        gross: parseFloat(gross.toFixed(2)),
      },
    };
  }
}

module.exports = new SCHADSService();
module.exports._internal = {
  getZonedParts,
  getOffsetMinutes,
  zonedWallClockToUtc,
  buildBoundaries,
  segmentShift,
  classifySegment,
  CATEGORIES,
  HOURS_KEY,
};
