const {
  calculateWeeklyOvertime,
  cycleWeeksFor,
} = require('../../services/weeklyOvertimeService');

const BASE = 25;

function weekdayShifts(count, hours = 8, rate = BASE, startDay = 1) {
  // 2026-06-01 is a Monday.
  const shifts = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(2026, 5, startDay + i));
    shifts.push({
      startTime: `${date.toISOString().slice(0, 10)}T09:00:00+10:00`,
      segments: [{ category: 'base', hours, rate }],
    });
  }
  return shifts;
}

describe('weekly overtime', () => {
  test('cycle lengths follow employment type', () => {
    expect(cycleWeeksFor('full_time')).toBe(1);
    expect(cycleWeeksFor('Permanent Part Time')).toBe(2);
    expect(cycleWeeksFor('casual')).toBe(4);
  });

  test('full-time: 40 ordinary hours pays 2h of OT1 premium', () => {
    const result = calculateWeeklyOvertime({
      shifts: weekdayShifts(5),
      employmentType: 'full_time',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    expect(result.hours).toBe(2);
    expect(result.ot1Hours).toBe(2);
    expect(result.ot2Hours).toBe(0);
    // 2h * (37.50 - 25.00)
    expect(result.amount).toBe(25);
  });

  test('full-time: 42 ordinary hours pays 2h OT1 and 2h OT2', () => {
    const result = calculateWeeklyOvertime({
      shifts: weekdayShifts(5).concat(
        weekdayShifts(1, 2, BASE, 6), // Saturday, still ordinary for the cap
      ),
      employmentType: 'full_time',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    // 5*8 + 2 = 42 ordinary hours.
    expect(result.hours).toBe(4);
    expect(result.ot1Hours).toBe(2);
    expect(result.ot2Hours).toBe(2);
    // 2h * 12.50 + 2h * 25.00
    expect(result.amount).toBe(75);
  });

  test('part-time: cap is 76 hours across a two-week cycle', () => {
    const shifts = weekdayShifts(10); // 80 hours
    const result = calculateWeeklyOvertime({
      shifts,
      employmentType: 'part_time',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    expect(result.hours).toBe(4);
    expect(result.amount).toBe(75);
  });

  test('casual: cap is 152 hours across a four-week cycle', () => {
    const shifts = [];
    for (let week = 0; week < 4; week += 1) {
      shifts.push(...weekdayShifts(5, 8, BASE, 1 + week * 7));
    }
    const result = calculateWeeklyOvertime({
      shifts,
      employmentType: 'casual',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    expect(result.hours).toBe(8);
    expect(result.ot1Hours).toBe(2);
    expect(result.ot2Hours).toBe(6);
    expect(result.amount).toBe(175);
  });

  test('daily overtime segments are not counted twice', () => {
    const shifts = [];
    // 8 ordinary + 4 daily-OT hours in one day.
    shifts.push({
      startTime: '2026-06-01T07:00:00+10:00',
      segments: [
        { category: 'base', hours: 8, rate: BASE },
        { category: 'overtimeFirst2h', hours: 2, rate: BASE * 1.5 },
        { category: 'overtimeAfter2h', hours: 2, rate: BASE * 2 },
      ],
    });
    // Three more 8h days => 8*4 + 8 = 40 ordinary hours.
    shifts.push(...weekdayShifts(3, 8, BASE, 2));
    shifts.push(...weekdayShifts(1, 8, BASE, 5));

    const result = calculateWeeklyOvertime({
      shifts,
      employmentType: 'full_time',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    expect(result.hours).toBe(2);
    expect(result.amount).toBe(25);
  });

  test('public holiday hours do not count towards the weekly cap', () => {
    const shifts = [
      {
        startTime: '2026-06-01T09:00:00+10:00',
        segments: [
          { category: 'base', hours: 8, rate: BASE },
          { category: 'publicHoliday', hours: 8, rate: BASE * 2.5 },
        ],
      },
      ...weekdayShifts(4, 8, BASE, 2),
    ];
    const result = calculateWeeklyOvertime({
      shifts,
      employmentType: 'full_time',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    // 8 + 32 = 40 ordinary hours; the 8 PH hours are excluded.
    expect(result.hours).toBe(2);
  });

  test('hours already paid above the OT rate never produce a negative premium', () => {
    // All ordinary hours are paid at 200%; the excess still cannot reduce pay.
    const shifts = weekdayShifts(5, 8, BASE * 2);
    const result = calculateWeeklyOvertime({
      shifts,
      employmentType: 'full_time',
      baseRate: BASE,
      multipliers: { overtimeFirst2h: 1.5, overtimeAfter2h: 2.0 },
    });
    expect(result.amount).toBe(0);
    expect(result.hours).toBe(2);
  });
});
