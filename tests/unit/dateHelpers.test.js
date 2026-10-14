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
