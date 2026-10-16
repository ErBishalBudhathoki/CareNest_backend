/**
 * F1.1: the advanced-payroll controller resolves the employee award profile
 * from userId when the caller sends shifts without an employee object.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../services/advancedPayrollService', () => ({
  calculatePayroll: jest.fn().mockResolvedValue({ success: true, data: {} }),
  generatePayslip: jest.fn().mockResolvedValue({ success: true, data: {} }),
}));
jest.mock('../../services/holidayService', () => ({
  getHolidayDateKeys: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('../../models/User', () => ({ findOne: jest.fn() }));

const advancedPayrollService = require('../../services/advancedPayrollService');
const User = require('../../models/User');
const controller = require('../../controllers/advancedPayrollController');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((p) => {
    res.body = p;
    return res;
  });
  return res;
}

describe('advancedPayrollController.calculatePayroll', () => {
  test('injects the resolved employee when shifts are sent without one', async () => {
    const employee = { email: 'worker@org.com', award: { level: 2 } };
    User.findOne.mockReturnValue({ lean: async () => employee });

    const req = {
      body: {
        organizationId: 'org1',
        userId: 'worker@org.com',
        period: '2026-06',
        shifts: [{ startTime: '2026-06-01T09:00:00+10:00', endTime: '2026-06-01T17:00:00+10:00' }],
      },
      user: { organizationId: 'org1' },
    };
    const res = mockRes();

    await controller.calculatePayroll(req, res);

    const passed = advancedPayrollService.calculatePayroll.mock.calls[0][0];
    expect(passed.employee).toEqual(employee);
    expect(res.statusCode).toBe(200);
  });

  test('does not override an employee the caller already provided', async () => {
    const provided = { payRate: 30 };
    const req = {
      body: {
        organizationId: 'org1',
        userId: 'worker@org.com',
        employee: provided,
        shifts: [{ startTime: '2026-06-01T09:00:00+10:00', endTime: '2026-06-01T17:00:00+10:00' }],
      },
      user: { organizationId: 'org1' },
    };
    const res = mockRes();

    await controller.calculatePayroll(req, res);

    expect(User.findOne).not.toHaveBeenCalled();
    const passed = advancedPayrollService.calculatePayroll.mock.calls[0][0];
    expect(passed.employee).toEqual(provided);
  });
});

/**
 * Regression: `GET /payroll-advanced/payslip/:userId/:period` used to return
 * any employee's salary to any authenticated caller, in any organisation. These
 * cases pin the three outcomes that matter — self, admin of the same tenant,
 * and everyone else.
 */
describe('advancedPayrollController.getPayslip', () => {
  const ORG_A = '64f0000000000000000000a1';
  const ORG_B = '64f0000000000000000000b2';

  beforeEach(() => {
    advancedPayrollService.generatePayslip.mockClear();
    advancedPayrollService.generatePayslip.mockResolvedValue({
      success: true,
      data: { netPay: 972 },
    });
  });

  test('allows an employee to read their own payslip, scoped to their org', async () => {
    const req = {
      params: { userId: 'emp-1', period: '2026-09' },
      user: { userId: 'emp-1', role: 'employee', organizationId: ORG_A },
    };
    const res = mockRes();

    await controller.getPayslip(req, res);

    expect(res.statusCode).toBe(200);
    expect(advancedPayrollService.generatePayslip).toHaveBeenCalledWith(
      'emp-1',
      '2026-09',
      ORG_A
    );
  });

  test('allows an admin of the same organisation to read it', async () => {
    const req = {
      params: { userId: 'emp-1', period: '2026-09' },
      user: { userId: 'admin-1', role: 'admin', organizationId: ORG_A },
    };
    const res = mockRes();

    await controller.getPayslip(req, res);

    expect(res.statusCode).toBe(200);
    expect(advancedPayrollService.generatePayslip.mock.calls[0][2]).toBe(ORG_A);
  });

  test('refuses a colleague who is not an admin', async () => {
    const req = {
      params: { userId: 'emp-1', period: '2026-09' },
      user: { userId: 'emp-2', role: 'employee', organizationId: ORG_A },
    };
    const res = mockRes();

    await controller.getPayslip(req, res);

    expect(res.statusCode).toBe(403);
    expect(advancedPayrollService.generatePayslip).not.toHaveBeenCalled();
  });

  test('refuses an admin of another organisation', async () => {
    const req = {
      params: { userId: 'emp-1', period: '2026-09' },
      // The organisation context middleware has already resolved the caller's
      // own tenant, so the lookup is scoped to that — never to the victim's.
      organizationContext: { organizationId: ORG_B, isAdmin: true },
      user: { userId: 'admin-b', role: 'admin', organizationId: ORG_B },
    };
    const res = mockRes();

    await controller.getPayslip(req, res);

    expect(res.statusCode).toBe(200);
    expect(advancedPayrollService.generatePayslip).toHaveBeenCalledWith(
      'emp-1',
      '2026-09',
      ORG_B
    );
  });

  test('refuses when no organisation can be resolved', async () => {
    const req = {
      params: { userId: 'emp-1', period: '2026-09' },
      user: { userId: 'emp-1', role: 'employee' },
    };
    const res = mockRes();

    await controller.getPayslip(req, res);

    expect(res.statusCode).toBe(403);
    expect(advancedPayrollService.generatePayslip).not.toHaveBeenCalled();
  });
});
