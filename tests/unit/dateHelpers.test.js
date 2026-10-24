/**
 * Canonical date-layer tests.
 *
 * These helpers are load-bearing: `parseFlexibleDate` replaced every
 * `new Date(storedString)` on the read path (Node reads a slash date as US
 * MM/DD), `normalizeToIsoDate` guards the ISO storage key that Mongo range
 * queries and the Flutter `DateTime.parse` readers depend on, and
 * `formatBprDate` produces the NDIS BPR CSV date column.
 *
 * The single most important property pinned here: a day-first string is NEVER
 * silently reinterpreted as month-first.
 */

const {
  DISPLAY_DATE_FORMAT,
  BPR_DATE_FORMAT,
  BPR_DATE_PATTERN,
  formatDisplayDate,
  formatDateAU,
  parseDisplayDate,
  parseFlexibleDate,
  normalizeToDisplayDate,
  normalizeToIsoDate,
  formatBprDate,
  getZonedDateParts,
  zonedWallClockToUtc,
} = require('../../utils/dateHelpers');

describe('dateHelpers — constants', () => {
  test('display and BPR formats are the canonical DD/MM/YYYY', () => {
    expect(DISPLAY_DATE_FORMAT).toBe('DD/MM/YYYY');
    expect(BPR_DATE_FORMAT).toBe('DD/MM/YYYY');
  });

  test('BPR pattern accepts DD/MM/YYYY and rejects ISO / US shapes', () => {
    expect(BPR_DATE_PATTERN.test('01/04/2026')).toBe(true);
    expect(BPR_DATE_PATTERN.test('2026/04/01')).toBe(false);
    expect(BPR_DATE_PATTERN.test('04/01/2026')).toBe(true); // shape only — order is validated elsewhere
    expect(BPR_DATE_PATTERN.test('1/4/2026')).toBe(false); // zero-padded only
  });
});

describe('dateHelpers — parseFlexibleDate (day-first, ISO-tolerant)', () => {
  test('reads a slash date as day-first, never month-first', () => {
    const d = parseFlexibleDate('01/04/2026');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 4, 1]);
  });

  test('reads a hyphen date as day-first (legacy holiday storage)', () => {
    const d = parseFlexibleDate('25-12-2026');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 12, 25]);
  });

  test('passes ISO dates through unchanged', () => {
    expect(parseFlexibleDate('2026-04-01').toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(parseFlexibleDate('2026-04-01T00:00:00Z').toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  test('rejects rollover instead of silently shifting the month', () => {
    expect(parseFlexibleDate('31/02/2026')).toBeNull();
    expect(parseFlexibleDate('32/01/2026')).toBeNull();
  });

  test('returns null for empty / non-date input', () => {
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate(null)).toBeNull();
    expect(parseFlexibleDate('nonsense')).toBeNull();
  });
});

describe('dateHelpers — parseDisplayDate (strict DD/MM/YYYY)', () => {
  test('parses DD/MM/YYYY and ISO, rejects US-only shapes', () => {
    expect(parseDisplayDate('01/04/2026').getMonth() + 1).toBe(4);
    expect(parseDisplayDate('2026-04-01').getUTCMonth() + 1).toBe(4);
    expect(parseDisplayDate('31/02/2026')).toBeNull();
  });
});

describe('dateHelpers — normalizeToDisplayDate', () => {
  test('formats any accepted input as DD/MM/YYYY', () => {
    expect(normalizeToDisplayDate('2026-04-01')).toBe('01/04/2026');
    expect(normalizeToDisplayDate('01/04/2026')).toBe('01/04/2026');
    expect(normalizeToDisplayDate('1/4/2026')).toBe('01/04/2026');
    expect(normalizeToDisplayDate('25-12-2026')).toBe('25/12/2026');
  });

  test('returns empty string when unparseable', () => {
    expect(normalizeToDisplayDate('31/02/2026')).toBe('');
    expect(normalizeToDisplayDate('')).toBe('');
    expect(normalizeToDisplayDate(undefined)).toBe('');
  });
});

describe('dateHelpers — normalizeToIsoDate (storage key)', () => {
  test('round-trips ISO input verbatim', () => {
    expect(normalizeToIsoDate('2026-04-01')).toBe('2026-04-01');
    expect(normalizeToIsoDate('2026-04-01T13:45:00Z')).toBe('2026-04-01');
  });

  test('converts day-first input to ISO without swapping day/month', () => {
    expect(normalizeToIsoDate('01/04/2026')).toBe('2026-04-01');
    expect(normalizeToIsoDate('25-12-2026')).toBe('2026-12-25');
  });

  test('produces a lexicographically sortable value', () => {
    const keys = ['25/12/2026', '01/04/2026', '15/06/2026'].map(normalizeToIsoDate);
    expect([...keys].sort()).toEqual(['2026-04-01', '2026-06-15', '2026-12-25']);
  });

  test('returns empty string when unparseable', () => {
    expect(normalizeToIsoDate('31/02/2026')).toBe('');
    expect(normalizeToIsoDate(null)).toBe('');
  });
});

describe('dateHelpers — formatBprDate (NDIS CSV column)', () => {
  test('formats a UTC-midnight service date as DD/MM/YYYY', () => {
    expect(formatBprDate(new Date('2026-04-01T00:00:00Z'))).toBe('01/04/2026');
    expect(formatBprDate(new Date('2026-12-25T00:00:00Z'))).toBe('25/12/2026');
  });

  test('output always satisfies the CSV date pattern', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-06-15T00:00:00Z', '2026-12-31T00:00:00Z']) {
      expect(BPR_DATE_PATTERN.test(formatBprDate(new Date(iso)))).toBe(true);
    }
  });

  test('does not shift the day for a UTC-midnight value', () => {
    // The regression this guards: reading local parts instead of UTC parts.
    expect(formatBprDate(new Date('2026-01-01T00:00:00Z'))).toBe('01/01/2026');
  });
});

describe('dateHelpers — formatDisplayDate', () => {
  test('is the DD/MM/YYYY display formatter', () => {
    expect(formatDisplayDate(new Date(2026, 3, 1))).toBe('01/04/2026');
    expect(formatDisplayDate('2026-04-01')).toBe('01/04/2026');
    expect(formatDisplayDate('not a date')).toBe('');
    // Kept as a thin alias of the legacy AU formatter — same output, stable API.
    expect(formatDisplayDate(new Date(2026, 11, 25))).toBe(formatDateAU(new Date(2026, 11, 25)));
  });
});

/**
 * Property-style coverage for the zone-aware helpers that worked time and
 * payroll depend on: `zonedWallClockToUtc` builds a shift's start/end instants
 * from an organisation-local wall clock, and `getZonedDateParts` reads them
 * back. The inputs are generated from a seeded PRNG so a failure is
 * reproducible from the seed printed in the assertion message.
 */
describe('dateHelpers — zoned wall clock (Australia/Sydney)', () => {
  const TZ = 'Australia/Sydney';

  // Small deterministic LCG: no dependency, same sequence on every run.
  const seeded = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  const zonedHHMM = (instant, timeZone = TZ) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(instant);
    const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
    return { hour: get('hour') % 24, minute: get('minute') };
  };

  const matchesWallClock = (instant, { year, month, day, hour, minute }) => {
    const parts = getZonedDateParts(instant, TZ);
    const time = zonedHHMM(instant);
    return (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      time.hour === hour &&
      time.minute === minute
    );
  };

  // A wall-clock time inside the spring-forward gap (02:00–02:59 on the first
  // Sunday in October) never happens locally. Scan an hour either side to tell
  // "this input does not exist" apart from "the helper returned the wrong
  // instant".
  const wallClockExists = (wall) => {
    const base = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    for (let delta = -120; delta <= 120; delta += 1) {
      if (matchesWallClock(new Date(base + delta * 60 * 1000), wall)) return true;
    }
    return false;
  };

  test('a local wall clock converts to the instant that reads back as itself', () => {
    const rand = seeded(20261025);
    let checked = 0;

    for (let i = 0; i < 400; i += 1) {
      const wall = {
        year: 2024 + Math.floor(rand() * 5),
        month: 1 + Math.floor(rand() * 12),
        day: 1 + Math.floor(rand() * 28),
        hour: Math.floor(rand() * 24),
        minute: Math.floor(rand() * 60),
      };

      const instant = zonedWallClockToUtc(
        wall.year,
        wall.month,
        wall.day,
        wall.hour,
        wall.minute,
        TZ,
      );

      if (!matchesWallClock(instant, wall)) {
        // Only a DST gap may legitimately skip; anything else is a bad instant.
        expect({ wall, exists: wallClockExists(wall) }).toEqual({
          wall,
          exists: false,
        });
        continue;
      }

      expect(getZonedDateParts(instant, TZ)).toEqual({
        year: wall.year,
        month: wall.month,
        day: wall.day,
      });
      expect(zonedHHMM(instant)).toEqual({
        hour: wall.hour,
        minute: wall.minute,
      });
      checked += 1;
    }

    // Almost every generated input must have been a real local time.
    expect(checked).toBeGreaterThan(380);
  });

  test('offsets are always AEST (+10) or AEDT (+11)', () => {
    const rand = seeded(5511);
    const start = Date.UTC(2024, 0, 1);
    const span = 4 * 365 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < 300; i += 1) {
      // Whole minutes only, so the offset difference is exact.
      const instant = new Date(Math.floor((start + rand() * span) / 60000) * 60000);
      const parts = getZonedDateParts(instant, TZ);
      const time = zonedHHMM(instant);
      const asUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        time.hour,
        time.minute,
      );
      const offsetMinutes = Math.round((asUtc - instant.getTime()) / 60000);

      expect([600, 660]).toContain(offsetMinutes);
    }
  });

  test('conversion is strictly increasing across a normal day', () => {
    let previous = -Infinity;
    for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += 7) {
      const instant = zonedWallClockToUtc(
        2026,
        6,
        15,
        Math.floor(minuteOfDay / 60),
        minuteOfDay % 60,
        TZ,
      );
      expect(instant.getTime()).toBeGreaterThan(previous);
      previous = instant.getTime();
    }
  });

  test('overnight shifts stay three hours, and the DST gap is one hour short', () => {
    const hours = (from, to) => (to.getTime() - from.getTime()) / (60 * 60 * 1000);

    // 22:00 -> next day 01:00 is the ordinary overnight window.
    expect(
      hours(
        zonedWallClockToUtc(2026, 10, 3, 22, 0, TZ),
        zonedWallClockToUtc(2026, 10, 4, 1, 0, TZ),
      ),
    ).toBe(3);

    // Clocks jump 02:00 -> 03:00 on 4 October 2026, so a five-hour wall-clock
    // span is four real hours, and 01:30 -> 03:30 is a single real hour.
    expect(
      hours(
        zonedWallClockToUtc(2026, 10, 3, 22, 0, TZ),
        zonedWallClockToUtc(2026, 10, 4, 3, 0, TZ),
      ),
    ).toBe(4);
    expect(
      hours(
        zonedWallClockToUtc(2026, 10, 4, 1, 30, TZ),
        zonedWallClockToUtc(2026, 10, 4, 3, 30, TZ),
      ),
    ).toBe(1);

    // Reading the day back across both DST transitions keeps the date.
    expect(getZonedDateParts(zonedWallClockToUtc(2026, 4, 5, 9, 0, TZ), TZ)).toEqual({
      year: 2026,
      month: 4,
      day: 5,
    });
    expect(getZonedDateParts(zonedWallClockToUtc(2026, 10, 4, 9, 0, TZ), TZ)).toEqual({
      year: 2026,
      month: 10,
      day: 4,
    });
  });
});
