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
    expect(result.data.baseRate).toBe(27.55);
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

  test('treats a 3pm–9pm shift as one afternoon shift', async () => {
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-06',
      employee,
      shifts: [shift('2026-06-01T15:00:00+10:00', '2026-06-01T21:00:00+10:00')],
    });
    expect(result.data.hoursBreakdown.baseHours).toBe(0);
    expect(result.data.hoursBreakdown.afternoonShiftHours).toBe(6);
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

  test('casual penalty reporting matches the additive gross pay', async () => {
    const casual = {
      ...employee,
      award: { ...employee.award, employmentType: 'casual' },
    };
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'c',
      period: '2026-06',
      employee: casual,
      shifts: [shift('2026-06-06T09:00:00+10:00', '2026-06-06T17:00:00+10:00')],
    });
    // 25% casual loading is additive to the 150% Saturday penalty.
    expect(result.data.penalties.saturday.amount).toBeCloseTo(
      result.data.grossPay,
      2,
    );
  });

  test('pays the full-time first-aid allowance once per week', async () => {
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-12',
      employee: { ...employee, award: { ...employee.award, firstAidAllowance: true } },
      shifts: [
        shift('2026-12-01T09:00:00+10:00', '2026-12-01T17:00:00+10:00', {
          firstAidShift: true,
        }),
        shift('2026-12-02T09:00:00+10:00', '2026-12-02T17:00:00+10:00', {
          firstAidShift: true,
        }),
      ],
    });
    expect(result.data.allowances.firstAid).toBe(21.43);
  });

  test('pays part-time first aid hourly up to the weekly cap', async () => {
    const partTime = {
      ...employee,
      award: {
        ...employee.award,
        employmentType: 'permanent_pt',
        firstAidAllowance: true,
      },
    };
    const result = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-12',
      employee: partTime,
      shifts: [
        shift('2026-12-01T09:00:00+10:00', '2026-12-01T17:00:00+10:00', {
          firstAidShift: true,
        }),
        shift('2026-12-02T09:00:00+10:00', '2026-12-02T17:00:00+10:00', {
          firstAidShift: true,
        }),
      ],
    });
    // 16 hours * $0.56, under the $21.43 weekly cap.
    expect(result.data.allowances.firstAid).toBe(8.96);
  });

  test('pays the meal allowance on overtime, with the extra after 4 hours', async () => {
    const mealEmployee = {
      ...employee,
      award: { ...employee.award, mealAllowanceEligible: true },
    };
    const shortOt = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-12',
      employee: mealEmployee,
      shifts: [shift('2026-12-01T06:00:00+10:00', '2026-12-01T16:00:00+10:00')],
    });
    expect(shortOt.data.allowances.meal).toBe(17.3);

    const longOt = await advancedPayrollService.calculatePayroll({
      userId: 'u1',
      period: '2026-12',
      employee: mealEmployee,
      shifts: [shift('2026-12-01T06:00:00+10:00', '2026-12-01T19:00:00+10:00')],
    });
    expect(longOt.data.allowances.meal).toBe(34.6);
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
    expect(profile.baseRate).toBe(33.19);
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
  const ORG = '64f0000000000000000000a1';

  test('returns a safe placeholder when no records exist', async () => {
    PayrollRecord.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
    const result = await advancedPayrollService.generatePayslip('u1', '2026-06', ORG);
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
    const result = await advancedPayrollService.generatePayslip('u1', '2026-06', ORG);
    expect(result.success).toBe(true);
    expect(result.data.earnings.total).toBe(1200);
    expect(result.data.netPay).toBe(972);
  });

  test('scopes the payroll lookup to the given organisation', async () => {
    PayrollRecord.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });

    await advancedPayrollService.generatePayslip('u1', '2026-06', ORG);

    // The query, not just the handler, has to carry the tenant: the same
    // employee id can exist in more than one organisation, and an unscoped
    // lookup returned the other tenant's salary for it.
    expect(PayrollRecord.find).toHaveBeenCalledWith({
      employeeId: 'u1',
      organizationId: ORG,
    });
  });

  test('refuses to build a payslip without an organisation', async () => {
    const result = await advancedPayrollService.generatePayslip('u1', '2026-06');
    expect(result.success).toBe(false);
    expect(PayrollRecord.find).not.toHaveBeenCalled();
  });
});
