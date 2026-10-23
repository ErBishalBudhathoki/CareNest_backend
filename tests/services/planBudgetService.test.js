jest.mock('../../models/Client', () => ({
  findOne: jest.fn(),
}));
jest.mock('../../models/Invoice', () => ({
  Invoice: { aggregate: jest.fn() },
}));

const Client = require('../../models/Client');
const { Invoice } = require('../../models/Invoice');
const planBudgetService = require('../../services/planBudgetService');

function mockClient(plan, fundingType = 'ndia_managed') {
  Client.findOne.mockReturnValue({
    select: () => ({
      lean: async () => ({
        _id: 'c1',
        fundingType,
        plan,
        clientFirstName: 'Ava',
        clientLastName: 'Nguyen',
      }),
    }),
  });
}

function mockConsumed(total) {
  Invoice.aggregate.mockResolvedValue([{ _id: null, total }]);
}

describe('planBudgetService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('skips employee invoices', async () => {
    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      invoiceType: 'employee',
      amount: 500,
    });
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(Client.findOne).not.toHaveBeenCalled();
  });

  test('does not require a plan for plan/self-managed clients', async () => {
    mockClient({}, 'plan_managed');
    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 500,
    });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  test('blocks an NDIA-managed invoice without a plan', async () => {
    mockClient({}, 'ndia_managed');
    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 500,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_REQUIRED');
  });

  test('allows a within-budget invoice inside the plan period', async () => {
    mockClient(
      {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        totalBudget: 1000,
      },
      'ndia_managed',
    );
    mockConsumed(200);

    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 300,
      serviceStart: '2026-06-01',
      serviceEnd: '2026-06-30',
    });

    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(500);
    expect(result.totalBudget).toBe(1000);
  });

  test('blocks a service period outside the plan', async () => {
    mockClient({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalBudget: 1000,
    });
    mockConsumed(0);

    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 100,
      serviceStart: '2025-12-01',
      serviceEnd: '2025-12-31',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('OUTSIDE_PLAN_PERIOD');
  });

  test('blocks an invoice above the remaining budget', async () => {
    mockClient({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalBudget: 1000,
    });
    mockConsumed(900);

    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 200,
      serviceStart: '2026-06-01',
      serviceEnd: '2026-06-30',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_PLAN_BUDGET');
    expect(result.remaining).toBe(100);
  });

  test('a documented override allows the invoice and is reported', async () => {
    mockClient({}, 'ndia_managed');
    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 500,
      allowOverride: true,
      overrideReason: 'Legacy plan uploaded late',
    });
    expect(result.ok).toBe(true);
    expect(result.overridden).toBe(true);
    expect(result.overrideReason).toBe('Legacy plan uploaded late');
  });

  test('fails closed when spend cannot be calculated', async () => {
    mockClient({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalBudget: 1000,
    });
    Invoice.aggregate.mockRejectedValue(new Error('db unavailable'));

    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'c1',
      amount: 100,
      serviceStart: '2026-06-01',
      serviceEnd: '2026-06-30',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_BUDGET_UNAVAILABLE');
  });
});
