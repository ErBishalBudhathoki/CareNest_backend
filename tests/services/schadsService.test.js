/**
 * Golden tests for the time-segmented SCHADS engine (Phase 1).
 *
 * See docs/NDIS_DEPTH_ROADMAP.md section 1.10 for the scenario list.
 * All boundary math is verified against real instants (explicit UTC offsets)
 * so the tests do not depend on the machine's local timezone.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const schadsService = require('../../services/schadsService');
const schadsRates = require('../../config/schadsRates');

const TZ = 'Australia/Sydney';

/** Build a shift from explicit offset ISO strings (keeps tests TZ-independent). */
const shift = (startTime, endTime, breakDuration = 0, extra = {}) => ({
  startTime,
  endTime,
  breakDuration,
  ...extra,
});

const breakdown = (s, config = {}) =>
  schadsService.calculateShiftBreakdown(s, { timezone: TZ, ...config });

describe('SCHADS engine — boundary splitting', () => {
  test('Mon 09:00–17:00 is all ordinary base hours', () => {
    // 2026-06-01 is a Monday; AEST (+10).
    const r = breakdown(
      shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00'),
    );
    expect(r.baseHours).toBe(8);
    expect(r.totalHours).toBe(8);
    expect(r.nightShiftHours).toBe(0);
    expect(r.saturdayHours).toBe(0);
  });

  test('Mon 15:00–21:00 splits 5h base + 1h afternoon at the 20:00 boundary', () => {
    const r = breakdown(
      shift('2026-06-01T15:00:00+10:00', '2026-06-01T21:00:00+10:00'),
    );
    expect(r.baseHours).toBe(5);
    expect(r.afternoonShiftHours).toBe(1);
    expect(r.totalHours).toBe(6);
  });

  test('Mon 14:00–22:00 splits 6h base + 2h afternoon at the 20:00 boundary', () => {
    const r = breakdown(
      shift('2026-06-01T14:00:00+10:00', '2026-06-01T22:00:00+10:00'),
    );
    expect(r.baseHours).toBe(6);
    expect(r.afternoonShiftHours).toBe(2);
    expect(r.totalHours).toBe(8);
  });

  test('Mon 22:00 → Tue 06:00 is 8h night', () => {
    const r = breakdown(
      shift('2026-06-01T22:00:00+10:00', '2026-06-02T06:00:00+10:00'),
    );
    expect(r.nightShiftHours).toBe(8);
    expect(r.baseHours).toBe(0);
    expect(r.totalHours).toBe(8);
  });

  test('Fri 22:00 → Sat 04:00 splits night + Saturday', () => {
    // 2026-06-05 is a Friday.
    const r = breakdown(
      shift('2026-06-05T22:00:00+10:00', '2026-06-06T04:00:00+10:00'),
    );
    expect(r.nightShiftHours).toBe(2); // 22:00–24:00 Fri
    expect(r.saturdayHours).toBe(4); // 00:00–04:00 Sat
    expect(r.totalHours).toBe(6);
  });

  test('Saturday and Sunday daytime bucket correctly', () => {
    const sat = breakdown(
      shift('2026-06-06T09:00:00+10:00', '2026-06-06T17:00:00+10:00'),
    );
    expect(sat.saturdayHours).toBe(8);
    const sun = breakdown(
      shift('2026-06-07T09:00:00+10:00', '2026-06-07T17:00:00+10:00'),
    );
    expect(sun.sundayHours).toBe(8);
  });

  test('public holiday overrides the weekday category', () => {
    const r = breakdown(
      shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00'),
      { holidaySet: new Set(['2026-06-01']) },
    );
    expect(r.publicHolidayHours).toBe(8);
    expect(r.baseHours).toBe(0);
  });

  test('public-holiday boundary splits mid-shift', () => {
    // Holiday starts 2026-06-02 (Tue). Shift Mon 22:00 → Tue 02:00.
    const r = breakdown(
      shift('2026-06-01T22:00:00+10:00', '2026-06-02T02:00:00+10:00'),
      { holidaySet: new Set(['2026-06-02']) },
    );
    expect(r.nightShiftHours).toBe(2); // Mon 22:00–24:00
    expect(r.publicHolidayHours).toBe(2); // Tue 00:00–02:00
    expect(r.totalHours).toBe(4);
  });
});

describe('SCHADS engine — overtime', () => {
  test('12h weekday shift yields 8h base + 2h OT1 + 2h OT2', () => {
    const r = breakdown(
      shift('2026-06-01T07:00:00+10:00', '2026-06-01T19:00:00+10:00'),
    );
    expect(r.baseHours).toBe(8);
    expect(r.overtimeFirst2h).toBe(2);
    expect(r.overtimeAfter2h).toBe(2);
    expect(r.totalHours).toBe(12);
  });

  test('breaks are unpaid and reduce the earliest segment', () => {
    const r = breakdown(
      shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00', 60),
    );
    expect(r.totalHours).toBe(7);
  });
});

describe('SCHADS engine — DST correctness', () => {
  test('fall-back night (Sat 22:00 → Sun 05:00) counts 8 real hours', () => {
    // Sydney fall-back: Sun 2026-04-05. Clocks go back 03:00 -> 02:00.
    const r = breakdown(
      shift('2026-04-04T22:00:00+11:00', '2026-04-05T05:00:00+10:00'),
    );
    expect(r.totalHours).toBe(8);
    expect(r.saturdayHours).toBe(2); // 22:00–24:00 Sat
    expect(r.sundayHours).toBe(6);
  });

  test('spring-forward night (Sat 22:00 → Sun 05:00) counts 6 real hours', () => {
    // Sydney spring-forward: Sun 2026-10-04. Clocks jump 02:00 -> 03:00.
    const r = breakdown(
      shift('2026-10-03T22:00:00+10:00', '2026-10-04T05:00:00+11:00'),
    );
    expect(r.totalHours).toBe(6);
    expect(r.saturdayHours).toBe(2); // 22:00–24:00 Sat
    expect(r.sundayHours).toBe(4);
  });
});

describe('SCHADS engine — robustness', () => {
  test('missing or invalid times return zeros', () => {
    expect(breakdown({}).totalHours).toBe(0);
    expect(breakdown(shift('nonsense', 'also-nonsense')).totalHours).toBe(0);
  });

  test('zero-length or reversed shifts return zeros', () => {
    const t = '2026-06-01T09:00:00+10:00';
    expect(breakdown(shift(t, t)).totalHours).toBe(0);
    expect(
      breakdown(shift('2026-06-01T17:00:00+10:00', '2026-06-01T09:00:00+10:00')).totalHours,
    ).toBe(0);
  });

  test('exposes additive segments alongside the flat aggregate', () => {
    const r = breakdown(
      shift('2026-06-01T15:00:00+10:00', '2026-06-01T21:00:00+10:00'),
    );
    expect(Array.isArray(r.segments)).toBe(true);
    expect(r.segments.length).toBe(2);
    expect(r.segments.map((s) => s.category)).toEqual(['base', 'afternoon']);
  });
});

describe('SCHADS rate table', () => {
  test('resolves base rate by level and stream', () => {
    expect(
      schadsRates.resolveBaseRate({ level: 2, stream: 'disability', date: '2026-01-01' }),
    ).toBe(25.8);
  });

  test('payPoint progression adds the configured step', () => {
    const base = schadsRates.resolveBaseRate({ level: 2, stream: 'disability', date: '2026-01-01' });
    const stepped = schadsRates.resolveBaseRate({
      level: 2,
      stream: 'disability',
      payPoint: '1.2',
      date: '2026-01-01',
    });
    expect(stepped).toBeGreaterThan(base);
  });

  test('multipliers are effective-dated and include casual loading', () => {
    const m = schadsRates.resolveMultipliers('MA000100', '2026-01-01');
    expect(m.saturday).toBe(1.5);
    expect(m.sunday).toBe(2.0);
    expect(m.publicHoliday).toBe(2.5);
    expect(m.casualLoading).toBe(0.25);
  });
});

describe('SCHADS casual loading is additive', () => {
  const profile = (isCasual) => ({
    timezone: TZ,
    baseRate: 25,
    isCasual,
  });

  test('casual Saturday is 175% (not 187.5%)', () => {
    const shiftData = shift(
      '2026-06-06T09:00:00+10:00', // Saturday
      '2026-06-06T17:00:00+10:00',
    );
    const permanent = schadsService.calculateShiftAmount(shiftData, profile(false));
    const casual = schadsService.calculateShiftAmount(shiftData, profile(true));
    expect(permanent.amount.gross).toBe(300); // 8h * 25 * 1.5
    expect(casual.amount.gross).toBe(350); // 8h * 25 * 1.75
  });

  test('casual Sunday is 225% (not 250%)', () => {
    const shiftData = shift(
      '2026-06-07T09:00:00+10:00', // Sunday
      '2026-06-07T17:00:00+10:00',
    );
    const permanent = schadsService.calculateShiftAmount(shiftData, profile(false));
    const casual = schadsService.calculateShiftAmount(shiftData, profile(true));
    expect(permanent.amount.gross).toBe(400); // 8h * 25 * 2.0
    expect(casual.amount.gross).toBe(450); // 8h * 25 * 2.25
  });

  test('casual public holiday is 275% (not 312.5%)', () => {
    const shiftData = shift(
      '2026-06-08T09:00:00+10:00',
      '2026-06-08T17:00:00+10:00',
    );
    const casual = schadsService.calculateShiftAmount(shiftData, {
      ...profile(true),
      holidaySet: new Set(['2026-06-08']),
    });
    expect(casual.amount.gross).toBe(550); // 8h * 25 * 2.75
  });

  test('casual night loading stays 140%', () => {
    const shiftData = shift(
      '2026-06-01T22:00:00+10:00',
      '2026-06-02T06:00:00+10:00',
    );
    const casual = schadsService.calculateShiftAmount(shiftData, profile(true));
    expect(casual.amount.gross).toBe(280); // 8h * 25 * 1.4
  });
});
