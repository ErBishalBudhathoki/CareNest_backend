/**
 * Tests for AdvancedPayrollService (Phase 1) — verifies the real SCHADS-driven
 * calculation replaces the previous mock while preserving the response shape.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/PayrollRecord', () => ({
  find: jest.fn(),
}));

const PayrollRecord = require('../../models/PayrollRecord');
const advancedPayrollService = require('../../services/advancedPayrollService');

const employee = {
  payRate: 30,
  employmentType: 'Permanent',
  award: { level: 2, stream: 'disability', employmentType: 'permanent_ft' },
};

const shift = (startTime, endTime, extra = {}) => ({
  startTime,
  endTime,
  breakDuration: 0,
  ...extra,
});

describe('AdvancedPayrollService.calculatePayroll (shift-based)', () => {
  test('returns the legacy response shape', async () => {
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-06',
      employee,
      shifts: [shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00')],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        userId: 'u1',
        period: '2026-06',
        baseRate: expect.any(Number),
        baseAmount: expect.any(Number),
        penalties: expect.objectContaining({
          saturday: expect.any(Object),
          sunday: expect.any(Object),
          publicHoliday: expect.any(Object),
          overtime: expect.any(Object),
          total: expect.any(Number),
        }),
        allowances: expect.objectContaining({ total: expect.any(Number) }),
        leaveAccrual: expect.any(Object),
        taxAndSuper: expect.objectContaining({
          tax: expect.any(Number),
          super: expect.any(Number),
        }),
        grossPay: expect.any(Number),
        netPay: expect.any(Number),
      }),
    );
  });

  test('uses the SCHADS rate table (level 2 disability base)', async () => {
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-06',
      employee,
      shifts: [shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00')],
    });
    expect(result.data.baseRate).toBe(25.8);
  });

  test('casual employment loads gross pay above permanent', async () => {
    const shifts = [shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00')];
    const perm = await advancedPayrollService.calculatePayroll({
      userId: 'p', period: '2026-06', employee, shifts,
    });
    const casual = await advancedPayrollService.calculatePayroll({
      userId: 'c',
      period: '2026-06',
      employee: { ...employee, award: { ...employee.award, employmentType: 'casual' } },
      shifts,
    });
    expect(casual.data.grossPay).toBeGreaterThan(perm.data.grossPay);
  });

  test('splits a 3pm–9pm shift into base + afternoon', async () => {
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-06',
      employee,
      shifts: [shift('2026-06-01T15:00:00+10:00', '2026-06-01T21:00:00+10:00')],
    });
    expect(result.data.hoursBreakdown.baseHours).toBe(5);
    expect(result.data.hoursBreakdown.afternoonShiftHours).toBe(1);
  });

  test('honours effective-dated rate overrides', async () => {
    const withOverride = {
      ...employee,
      award: {
        ...employee.award,
        rateOverrides: [{ effectiveFrom: new Date('2026-01-01'), rates: { baseRate: 40 } }],
      },
    };
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-06',
      employee: withOverride,
      shifts: [shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00')],
    });
    expect(result.data.baseRate).toBe(40);
  });
});

describe('AdvancedPayrollService.calculatePayroll (legacy aggregate path)', () => {
  test('computes penalties from aggregate hours', async () => {
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u3',
      period: '2026-06',
      employee,
      hours: { regular: 8, saturday: 4, publicHoliday: 2 },
    });
    expect(result.success).toBe(true);
    expect(result.data.penalties.saturday.hours).toBe(4);
    expect(result.data.penalties.publicHoliday.hours).toBe(2);
    expect(result.data.grossPay).toBeGreaterThan(0);
  });
});

describe('AdvancedPayrollService legacy label + resolved-rate compatibility', () => {
  test('parses legacy "Level 2" + stream label', () => {
    const profile = advancedPayrollService.resolveProfile({
      classificationLevel: 'Level 2',
      stream: 'Home Care (Disability)',
      employmentType: 'Permanent',
    });
    expect(profile.baseRate).toBe(25.8);
    expect(profile.isCasual).toBe(false);
  });

  test('detects casual from the legacy employmentType label', () => {
    const profile = advancedPayrollService.resolveProfile({
      classificationLevel: 'Level 2',
      stream: 'Home Care (Disability)',
      employmentType: 'Casual',
    });
    expect(profile.isCasual).toBe(true);
  });

  test('uses legacy fully-resolved rates without double-loading casual', async () => {
    // A casual employee whose stored rates already include the 25% loading.
    const legacyCasual = {
      employmentType: 'Casual',
      payRate: 32.25, // 25.80 * 1.25
      rates: {
        baseRate: 32.25,
        saturdayRate: 48.38,
        sundayRate: 56.44,
        publicHolidayRate: 80.63,
        overtimeRate: 38.7,
        overtimeRate2: 51.6,
        nightShiftRate: 37.09,
        eveningShiftRate: 36.28,
      },
    };
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'legacy',
      period: '2026-06',
      employee: legacyCasual,
      shifts: [shift('2026-06-01T09:00:00+10:00', '2026-06-01T17:00:00+10:00')],
    });
    // 8h at the stored base 32.25 => 258.00 (not 32.25 * 1.25).
    expect(result.data.grossPay).toBeCloseTo(258.0, 2);
  });
});

describe('AdvancedPayrollService.generatePayslip', () => {
  test('returns a safe placeholder when no records exist', async () => {
    PayrollRecord.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
    const result = await advancedPayrollService.generatePayslip('u1', '2026-06');
    expect(result.success).toBe(true);
    expect(result.data.earnings.total).toBe(0);
    expect(result.data.netPay).toBe(0);
  });

  test('derives a payslip from a stored payroll record', async () => {
    PayrollRecord.find.mockReturnValue({
      sort: () => ({
        lean: async () => [
          {
            _id: 'rec1',
            employeeId: 'u1',
            periodStart: new Date('2026-06-01T00:00:00Z'),
            totalHours: 40,
            grossPay: 1200,
            taxWithheld: 228,
            superContribution: 132,
            netPay: 972,
          },
        ],
      }),
    });
    const result = await advancedPayrollService.generatePayslip('u1', '2026-06');
    expect(result.success).toBe(true);
    expect(result.data.earnings.total).toBe(1200);
    expect(result.data.netPay).toBe(972);
  });
});
