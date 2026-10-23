const {
  parseDurationToHours,
  formatDurationFromSeconds,
} = require('../../utils/timeHelpers');

describe('parseDurationToHours', () => {
  test('parses HH:mm:ss', () => {
    expect(parseDurationToHours('00:30:00')).toBeCloseTo(0.5);
    expect(parseDurationToHours('1:30:00')).toBeCloseTo(1.5);
    expect(parseDurationToHours('02:15:30')).toBeCloseTo(2 + 15 / 60 + 30 / 3600);
    expect(parseDurationToHours('24:00:00')).toBeCloseTo(24);
  });

  test('accepts numeric hours and numeric strings (legacy rows)', () => {
    expect(parseDurationToHours(7.5)).toBeCloseTo(7.5);
    expect(parseDurationToHours('7.5')).toBeCloseTo(7.5);
    expect(parseDurationToHours(0)).toBe(0);
  });

  test('returns 0 for unparseable input instead of NaN', () => {
    expect(parseDurationToHours(null)).toBe(0);
    expect(parseDurationToHours(undefined)).toBe(0);
    expect(parseDurationToHours('')).toBe(0);
    expect(parseDurationToHours('abc')).toBe(0);
    expect(parseDurationToHours('12')).toBe(12); // bare number = hours
  });

  test('sub-hour values are not truncated to zero', () => {
    // The old invoice code used parseFloat, which returned 0 for "00:30:00".
    expect(parseDurationToHours('00:15:00')).toBeCloseTo(0.25);
    expect(parseDurationToHours('00:45:00')).toBeCloseTo(0.75);
  });
});

describe('formatDurationFromSeconds', () => {
  test('formats without capping hours at 24', () => {
    expect(formatDurationFromSeconds(0)).toBe('00:00:00');
    expect(formatDurationFromSeconds(90)).toBe('00:01:30');
    expect(formatDurationFromSeconds(2 * 3600 + 15 * 60 + 30)).toBe('02:15:30');
    expect(formatDurationFromSeconds(30 * 3600)).toBe('30:00:00');
  });

  test('tolerates negative/invalid values', () => {
    expect(formatDurationFromSeconds(-60)).toBe('00:00:00');
    expect(formatDurationFromSeconds(undefined)).toBe('00:00:00');
  });
});
