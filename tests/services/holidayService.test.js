const HolidayService = require('../../services/holidayService');

describe('HolidayService public holiday filtering', () => {
  test('national holidays apply to every state', () => {
    expect(
      HolidayService.publicHolidayAppliesToState({ counties: null }, 'NSW'),
    ).toBe(true);
    expect(
      HolidayService.publicHolidayAppliesToState({ counties: [] }, 'VIC'),
    ).toBe(true);
  });

  test('state-specific holidays only apply to that state', () => {
    const row = { counties: ['AU-NSW', 'AU-ACT'] };
    expect(HolidayService.publicHolidayAppliesToState(row, 'NSW')).toBe(true);
    expect(HolidayService.publicHolidayAppliesToState(row, 'ACT')).toBe(true);
    expect(HolidayService.publicHolidayAppliesToState(row, 'VIC')).toBe(false);
  });

  test('an unknown organisation state keeps the full calendar', () => {
    expect(
      HolidayService.publicHolidayAppliesToState(
        { counties: ['AU-QLD'] },
        null,
      ),
    ).toBe(true);
  });

  test('date keys accept the legacy DD-MM-YYYY and DD/MM/YYYY formats', () => {
    expect(HolidayService.toDateKey('25-12-2026')).toBe('2026-12-25');
    expect(HolidayService.toDateKey('25/12/2026')).toBe('2026-12-25');
    expect(HolidayService.toDateKey('2026-12-25')).toBe('2026-12-25');
    expect(HolidayService.toDateKey('')).toBeNull();
  });
});
