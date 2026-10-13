/**
 * Phase 1 gap: public holidays must be convertible to engine date keys and
 * accepted by the SCHADS segmentation.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const HolidayService = require('../../services/holidayService');
const schadsService = require('../../services/schadsService');

describe('HolidayService.toDateKey', () => {
  test('converts DD-MM-YYYY (DB format)', () => {
    expect(HolidayService.toDateKey('25-12-2026')).toBe('2026-12-25');
  });

  test('converts DD/MM/YYYY', () => {
    expect(HolidayService.toDateKey('01/04/2026')).toBe('2026-04-01');
  });

  test('converts ISO', () => {
    expect(HolidayService.toDateKey('2026-04-01T00:00:00.000Z')).toBe('2026-04-01');
  });

  test('returns null for junk', () => {
    expect(HolidayService.toDateKey('not-a-date')).toBeNull();
    expect(HolidayService.toDateKey(null)).toBeNull();
  });
});

describe('SCHADS engine consumes a holidaySet', () => {
  test('classifies a holiday weekday as public holiday hours', () => {
    const shift = {
      startTime: '2026-06-01T09:00:00+10:00',
      endTime: '2026-06-01T17:00:00+10:00',
      breakDuration: 0,
    };
    const r = schadsService.calculateShiftBreakdown(shift, {
      timezone: 'Australia/Sydney',
      holidaySet: new Set(['2026-06-01']),
    });
    expect(r.publicHolidayHours).toBe(8);
    expect(r.baseHours).toBe(0);
  });
});
