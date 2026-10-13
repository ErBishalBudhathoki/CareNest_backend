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
