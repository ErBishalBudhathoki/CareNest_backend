/**
 * SCHADS shift breakdown engine - time-segmented.
 *
 * Replaces the previous whole-shift, start-day-only approximation.
 * See docs/NDIS_DEPTH_ROADMAP.md section 1.2 for the evidence.
 *
 * The engine splits a shift at every rate boundary:
 *   - shift class: afternoon (finishes after 1800) / night (finishes by 0600)
 *   - calendar: weekday->Saturday, Saturday->Sunday, Sunday->weekday
 *   - public-holiday entry/exit
 *   - overnight mixed shifts: 1800/0600 split
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
  // Milestone 5.1: SCHADS Award Clause 25.7 Sleepover span (paid via flat allowance)
  SLEEPOVER: 'sleepover',
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
  // Milestone 5.1: Distinct tracking of passive sleepover hours
  [CATEGORIES.SLEEPOVER]: 'sleepoverHours',
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
    for (const h of [0, 6, 18, 20]) {
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
 * Resolve the weekday penalty category for a shift using the SCHADS shift
 * definitions rather than clock boundaries:
 *
 *  - Afternoon shift: finishes after 18:00 and at or before midnight.
 *  - Night shift: finishes after midnight and at or before 06:00.
 *  - A shift that crosses midnight but finishes after 06:00 is mixed: its
 *    18:00–06:00 hours are night and the remainder is ordinary.
 *  - Any other shift is an ordinary day shift.
 *
 * The finish-time rule is why a 10:00–18:30 shift is an afternoon shift for
 * its whole duration, while a 06:00–14:00 shift attracts no night loading.
 */
function resolveShiftCategory(start, end, timeZone) {
  const startParts = getZonedParts(start, timeZone);
  const lastParts = getZonedParts(new Date(end.getTime() - 1), timeZone);
  const crossesMidnight = startParts.dateKey !== lastParts.dateKey;
  const lastMinuteOfDay = lastParts.hour * 60 + lastParts.minute;

  if (!crossesMidnight) {
    return lastMinuteOfDay >= 18 * 60 ? CATEGORIES.AFTERNOON : CATEGORIES.BASE;
  }

  if (lastMinuteOfDay < 6 * 60) return CATEGORIES.NIGHT;

  // Crossed midnight and finishes after 06:00: classify per hour.
  return 'mixed';
}

/**
 * Classify one segment.
 *
 * Weekend and public-holiday rates always take precedence over the weekday
 * shift loading. Weekday segments inherit the shift-level category resolved
 * from the finish time (see resolveShiftCategory).
 *
 * @param {Date} segStart
 * @param {Date} segEnd
 * @param {string} timeZone
 * @param {Set<string>} holidaySet
 * @param {string} shiftCategory one of base/afternoon/night/'mixed'
 */
function classifySegment(segStart, segEnd, timeZone, holidaySet, shiftCategory) {
  const p = getZonedParts(segStart, timeZone);
  if (holidaySet.has(p.dateKey)) return CATEGORIES.PUBLIC_HOLIDAY;
  if (p.weekday === 0) return CATEGORIES.SUNDAY;
  if (p.weekday === 6) return CATEGORIES.SATURDAY;

  if (shiftCategory === 'mixed') {
    const minuteOfDay = p.hour * 60 + p.minute;
    // Night-shift hours are 18:00–06:00 for a shift that runs past midnight.
    if (minuteOfDay < 6 * 60 || minuteOfDay >= 18 * 60) {
      return CATEGORIES.NIGHT;
    }
    return CATEGORIES.BASE;
  }

  return shiftCategory;
}

function zeroAggregates() {
  const agg = {};
  for (const key of Object.values(HOURS_KEY)) {
    agg[key] = 0;
  }
  // Milestone 5.1: Tracking sleepover metrics alongside standard aggregates
  agg.sleepoverCount = 0;
  agg.disturbanceHours = 0;
  agg.activeHours = 0;
  agg.totalHours = 0;
  return agg;
}

function aggregateSegments(segments) {
  const agg = zeroAggregates();
  let paidMinutes = 0;
  let activeMinutes = 0;
  let disturbanceMinutes = 0;
  let hasSleepover = false;

  for (const seg of segments) {
    const hours = seg.minutes / 60;
    const key = HOURS_KEY[seg.category];
    if (key) agg[key] += hours;

    if (seg.category === CATEGORIES.SLEEPOVER) {
      hasSleepover = true;
      // Sleepover sleeping hours are remunerated via flat allowance under Clause 25.7,
      // not hourly base/penalty wages.
    } else if (seg.isDisturbance) {
      disturbanceMinutes += seg.minutes;
      paidMinutes += seg.minutes;
    } else {
      activeMinutes += seg.minutes;
      paidMinutes += seg.minutes;
    }
  }

  for (const k of Object.keys(agg)) {
    agg[k] = parseFloat(agg[k].toFixed(2));
  }

  // Milestone 5.1: Populate sleepover and disturbance indicators
  agg.sleepoverCount = agg.sleepoverHours > 0 ? 1 : 0;
  agg.disturbanceHours = parseFloat((disturbanceMinutes / 60).toFixed(2));
  agg.activeHours = parseFloat((activeMinutes / 60).toFixed(2));
  // Total hourly-compensated hours: active hours + disturbance hours (if sleepover), or all hours (if standard)
  agg.totalHours = parseFloat((paidMinutes / 60).toFixed(2));
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

  // Milestone 5.1: SCHADS Award Clause 25.7 Sleepover Detection & Disturbance Evaluation
  const declaredShiftType = (shift.shiftType || '').toString().toLowerCase();
  const isSleepoverDeclared = declaredShiftType === 'sleepover';

  const rawDisturbances = Array.isArray(shift.disturbances)
    ? shift.disturbances
    : Array.isArray(shift.workedTime?.disturbances)
      ? shift.workedTime.disturbances
      : [];
  const parsedDisturbances = rawDisturbances.map((d) => {
    let dur = Number(d.durationMinutes) || 0;
    if (!dur && d.startTime && d.endTime) {
      dur = Math.max(0, Math.round((new Date(d.endTime) - new Date(d.startTime)) / MS_PER_MIN));
    }
    return {
      startTime: d.startTime ? new Date(d.startTime) : null,
      endTime: d.endTime ? new Date(d.endTime) : null,
      reason: typeof d.reason === 'string' ? d.reason : '',
      durationMinutes: dur,
    };
  });
  const totalDisturbanceMinutes =
    parsedDisturbances.reduce((sum, d) => sum + (d.durationMinutes || 0), 0) ||
    Number(shift.totalDisturbanceMinutes || 0);

  // Clause 25.7(e)(iii): > 60 cumulative disturbance minutes converts sleepover to active night
  const isConvertedToActiveNight =
    Boolean(shift.convertedToActiveNight) ||
    (isSleepoverDeclared && totalDisturbanceMinutes > 60);

  // If sleepover and NOT converted to active night, isolate the 8h sleepover span
  if (isSleepoverDeclared && !isConvertedToActiveNight) {
    let sleepStart;
    let sleepEnd;

    if (shift.sleepoverStartTime && shift.sleepoverEndTime) {
      sleepStart = new Date(shift.sleepoverStartTime);
      sleepEnd = new Date(shift.sleepoverEndTime);
    } else {
      const shiftDurationMinutes = Math.round((end.getTime() - start.getTime()) / MS_PER_MIN);
      if (shiftDurationMinutes <= 8 * 60) {
        // Shift is 8 hours or less: the whole duration is the sleepover span
        sleepStart = start;
        sleepEnd = end;
      } else {
        // Standard sleepover window is 22:00 to 06:00 in the target timezone
        const startParts = getZonedParts(start, timezone);
        let defStart = zonedWallClockToUtc(startParts.year, startParts.month, startParts.day, 22, 0, timezone);
        let defEnd = new Date(defStart.getTime() + 8 * 60 * MS_PER_MIN);

        // Clamp to shift boundaries
        const sMs = Math.max(start.getTime(), defStart.getTime());
        const eMs = Math.min(end.getTime(), defEnd.getTime());
        if (eMs > sMs) {
          sleepStart = new Date(sMs);
          sleepEnd = new Date(eMs);
        } else {
          sleepStart = start;
          sleepEnd = end;
        }
      }
    }

    // Active segments before and after sleepover
    const activeIntervals = [];
    if (sleepStart.getTime() > start.getTime()) {
      activeIntervals.push({ from: start, to: sleepStart });
    }
    if (end.getTime() > sleepEnd.getTime()) {
      activeIntervals.push({ from: sleepEnd, to: end });
    }

    const baseActiveSegments = [];
    for (const interval of activeIntervals) {
      const boundaries = buildBoundaries(interval.from, interval.to, timezone);
      const cat = resolveShiftCategory(interval.from, interval.to, timezone);
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        const segStart = new Date(boundaries[i]);
        const segEnd = new Date(boundaries[i + 1]);
        const minutes = Math.round((segEnd.getTime() - segStart.getTime()) / MS_PER_MIN);
        if (minutes <= 0) continue;
        baseActiveSegments.push({
          from: segStart.toISOString(),
          to: segEnd.toISOString(),
          minutes,
          category: classifySegment(segStart, segEnd, timezone, holidaySet, cat),
        });
      }
    }

    // Deduct unpaid break from active segments
    let breakRemaining = breakMins;
    for (const seg of baseActiveSegments) {
      if (breakRemaining <= 0) break;
      const take = Math.min(seg.minutes, breakRemaining);
      seg.minutes -= take;
      breakRemaining -= take;
    }

    // Apply daily overtime threshold ONLY to active hours
    const standardMinutes = standardHoursPerDay * 60;
    let ordinaryAccumulated = 0;
    let overtimeAccumulated = 0;
    const finalSegments = [];

    for (const seg of baseActiveSegments) {
      if (seg.minutes <= 0) continue;
      if (seg.category === CATEGORIES.PUBLIC_HOLIDAY) {
        finalSegments.push({ ...seg });
        continue;
      }
      let remaining = seg.minutes;
      while (remaining > 0) {
        if (ordinaryAccumulated < standardMinutes) {
          const take = Math.min(remaining, standardMinutes - ordinaryAccumulated);
          finalSegments.push({ ...seg, minutes: take });
          ordinaryAccumulated += take;
          remaining -= take;
          continue;
        }
        const ot1Remaining = Math.max(0, 2 * 60 - overtimeAccumulated);
        if (ot1Remaining > 0) {
          const take = Math.min(remaining, ot1Remaining);
          finalSegments.push({ ...seg, minutes: take, category: CATEGORIES.OVERTIME_1 });
          overtimeAccumulated += take;
          remaining -= take;
          continue;
        }
        finalSegments.push({ ...seg, minutes: remaining, category: CATEGORIES.OVERTIME_AFTER });
        overtimeAccumulated += remaining;
        remaining = 0;
      }
    }

    // Add passive sleepover segment (paid via flat allowance, 0 hourly wage)
    const sleepoverMinutes = Math.round((sleepEnd.getTime() - sleepStart.getTime()) / MS_PER_MIN);
    if (sleepoverMinutes > 0) {
      finalSegments.push({
        from: sleepStart.toISOString(),
        to: sleepEnd.toISOString(),
        minutes: sleepoverMinutes,
        category: CATEGORIES.SLEEPOVER,
        isSleepover: true,
      });
    }

    // Milestone 5.1: Disturbance segments under Clause 25.7(e)
    // 1 hour minimum at overtime rate per disturbance
    if (parsedDisturbances.length > 0) {
      for (const d of parsedDisturbances) {
        const paidDisturbanceMins = Math.max(60, d.durationMinutes || 60);
        finalSegments.push({
          from: (d.startTime || sleepStart).toISOString(),
          to: (d.endTime || new Date((d.startTime || sleepStart).getTime() + paidDisturbanceMins * MS_PER_MIN)).toISOString(),
          minutes: paidDisturbanceMins,
          category: CATEGORIES.OVERTIME_1,
          isDisturbance: true,
          reason: d.reason || '',
        });
      }
    } else if (totalDisturbanceMinutes > 0) {
      const paidDisturbanceMins = Math.max(60, totalDisturbanceMinutes);
      finalSegments.push({
        from: sleepStart.toISOString(),
        to: new Date(sleepStart.getTime() + paidDisturbanceMins * MS_PER_MIN).toISOString(),
        minutes: paidDisturbanceMins,
        category: CATEGORIES.OVERTIME_1,
        isDisturbance: true,
      });
    }

    const aggregates = aggregateSegments(finalSegments);
    aggregates.convertedToActiveNight = false;
    return { segments: finalSegments, aggregates };
  }

  // Standard path: non-sleepover shift OR sleepover converted to active night
  const boundaries = buildBoundaries(start, end, timezone);
  const baseSegments = [];

  // SCHADS classifies the weekday penalty by the shift's finish time, not by
  // the clock time of each segment. Resolve it once for the whole shift; the
  // overnight/mixed case is handled per segment inside classifySegment.
  const shiftCategory = resolveShiftCategory(start, end, timezone);

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const segStart = new Date(boundaries[i]);
    const segEnd = new Date(boundaries[i + 1]);
    const minutes = Math.round((segEnd.getTime() - segStart.getTime()) / MS_PER_MIN);
    if (minutes <= 0) continue;
    baseSegments.push({
      from: segStart.toISOString(),
      to: segEnd.toISOString(),
      minutes,
      category: classifySegment(segStart, segEnd, timezone, holidaySet, shiftCategory),
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

  const aggregates = aggregateSegments(segments);
  if (isConvertedToActiveNight) {
    aggregates.convertedToActiveNight = true;
  }
  return { segments, aggregates };
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
        // Milestone 5.1: Passive sleepover hours have $0 hourly rate (remunerated via flat sleepover allowance)
        case CATEGORIES.SLEEPOVER:
          return 0;
        case CATEGORIES.BASE:
        default:
          return baseRate * (mult.base || 1) * (1 + casualLoading);
      }
    };

    const byCategory = {};
    let gross = 0;
    const pricedSegments = [];
    for (const seg of segments) {
      const hours = seg.minutes / 60;
      const rate = rateFor(seg.category);
      const amt = hours * rate;
      byCategory[seg.category] = (byCategory[seg.category] || 0) + amt;
      gross += amt;
      pricedSegments.push({
        ...seg,
        hours,
        rate: parseFloat(rate.toFixed(4)),
        amount: parseFloat(amt.toFixed(2)),
      });
    }
    for (const k of Object.keys(byCategory)) {
      byCategory[k] = parseFloat(byCategory[k].toFixed(2));
    }

    const declaredType = (shift.shiftType || '').toString().toLowerCase();
    const isSleepover = declaredType === 'sleepover';
    const isConverted = Boolean(aggregates.convertedToActiveNight);

    return {
      segments: pricedSegments,
      aggregates,
      amount: {
        baseRate,
        hours: aggregates.totalHours,
        byCategory,
        gross: parseFloat(gross.toFixed(2)),
      },
      // Milestone 5.1: Attach sleepoverAllowance and conversion indicator
      sleepoverAllowance: isSleepover && !isConverted
        ? schadsRates.resolveAllowances(undefined, shift.startTime).sleepoverAllowance
        : 0,
      convertedToActiveNight: isConverted,
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
  resolveShiftCategory,
  classifySegment,
  CATEGORIES,
  HOURS_KEY,
};
