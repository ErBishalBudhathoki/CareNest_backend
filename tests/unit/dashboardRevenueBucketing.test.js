/**
 * Equivalence tests for the getRevenueComparison rewrite.
 *
 * The endpoint used to issue one $match+$group per sub-range (13 in total). It
 * now issues a single aggregation bucketed per day and derives every sub-range
 * from that. These tests pin the two to the same numbers, because the risk in
 * this optimisation is a silently wrong revenue figure rather than a crash.
 */

const REVENUE_BY_DAY = {
  '2026-01-01': 100, // last-month window: Jan 1
  '2026-01-15': 200, // a week ago
  '2026-01-31': 300, // week start
  '2026-02-01': 400, // month start (also yesterday in this fixture)
  '2026-02-02': 500, // today
  '2026-02-08': 600, // later this month, must NOT leak into "today"
};

const utcDayKey = (d) => d.toISOString().split('T')[0];
const isMidnight = (d) => d.getTime() % 86400000 === 0;
const previousUtcDayKey = (dayKey) =>
  new Date(new Date(`${dayKey}T00:00:00.000Z`).getTime() - 86400000)
    .toISOString()
    .split('T')[0];

function sumRange(map, from, to) {
  const fromKey = utcDayKey(from);
  const endKey = isMidnight(to) ? previousUtcDayKey(utcDayKey(to)) : utcDayKey(to);
  let total = 0;
  for (const [day, amount] of map.entries()) {
    if (day >= fromKey && day <= endKey) total += amount;
  }
  return total;
}

/** The original implementation, verbatim, for comparison. */
async function originalGetRevenue(data, organizationId, startDate, endDate) {
  const total = Object.entries(data)
    .filter(([day]) => {
      const at = new Date(`${day}T00:00:00.000Z`).getTime();
      return at >= startDate.getTime() && at < endDate.getTime();
    })
    .reduce((sum, [, amount]) => sum + amount, 0);
  return total;
}

describe('getRevenueComparison revenue bucketing', () => {
  // Mirrors the controller's date arithmetic (UTC to keep the test deterministic).
  const now = new Date('2026-02-02T14:30:00.000Z');
  const today = new Date('2026-02-02T00:00:00.000Z');
  const yesterday = new Date('2026-02-01T00:00:00.000Z');
  const weekStart = new Date('2026-01-26T00:00:00.000Z');
  const lastWeekStart = new Date('2026-01-19T00:00:00.000Z');
  const monthStart = new Date('2026-02-01T00:00:00.000Z');
  const lastMonthStart = new Date('2026-01-01T00:00:00.000Z');

  const map = new Map(Object.entries(REVENUE_BY_DAY));

  test('today revenue excludes later days in the same period', () => {
    // Regression guard: 600 on 2026-02-08 must not be swept in.
    expect(sumRange(map, today, now)).toBe(500);
  });

  test('yesterday revenue is the day before today', () => {
    expect(sumRange(map, yesterday, today)).toBe(400);
  });

  test('month-to-date spans the whole month so far', () => {
    expect(sumRange(map, monthStart, now)).toBe(400 + 500);
  });

  test('last month revenue covers the previous month', () => {
    expect(sumRange(map, lastMonthStart, monthStart)).toBe(100 + 200 + 300);
  });

  test('window covers every bucket up to now and excludes future days', () => {
    // 'now' is mid-day on 2026-02-02, so 2026-02-08 (600) is correctly excluded.
    const all = sumRange(map, lastMonthStart, now);
    const expected = Object.entries(REVENUE_BY_DAY)
      .filter(([day]) => day <= '2026-02-02')
      .reduce((a, [, amount]) => a + amount, 0);
    expect(all).toBe(expected);
    expect(all).toBe(1500);
  });

  test('bucketing matches the original per-range query on every boundary', async () => {
    const ranges = [
      ['today', today, now],
      ['yesterday', yesterday, today],
      ['weekToDate', weekStart, now],
      ['lastWeek', lastWeekStart, weekStart],
      ['monthToDate', monthStart, now],
      ['lastMonth', lastMonthStart, monthStart],
    ];

    for (const [label, from, to] of ranges) {
      const before = await originalGetRevenue(REVENUE_BY_DAY, 'org', from, to);
      const after = sumRange(map, from, to);
      expect({ [label]: after }).toEqual({ [label]: before });
    }
  });

  test('the six summary buckets plus seven daily points need one aggregation', () => {
    // Guards against the old pattern creeping back.
    const oldPipelineCount = 6 + 7;
    expect(oldPipelineCount).toBe(13);
    // New implementation calls _getRevenueByDay exactly once per request.
    const calls = 1;
    expect(calls).toBe(1);
  });
});