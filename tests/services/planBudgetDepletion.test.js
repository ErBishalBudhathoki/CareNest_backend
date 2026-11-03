/**
 * Milestone 6.3: NDIS Plan Budget Drawdown Tracking & Depletion Warning Engine Unit Tests
 */

jest.mock('../../models/Client', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../models/Invoice', () => ({
  Invoice: { aggregate: jest.fn(), find: jest.fn() },
}));

const Client = require('../../models/Client');
const { Invoice } = require('../../models/Invoice');
const planBudgetService = require('../../services/planBudgetService');

function mockClientPlan({ totalBudget = 10000, fundingType = 'ndia_managed' } = {}) {
  Client.findOne.mockReturnValue({
    select: () => ({
      lean: async () => ({
        _id: 'client123',
        fundingType,
        clientFirstName: 'Budget',
        clientLastName: 'Tester',
        plan: {
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          totalBudget,
          categories: [
            { categoryNumber: '01', name: 'Core Supports', budget: totalBudget },
          ],
        },
      }),
    }),
  });
}

function mockInvoiceConsumed(total) {
  Invoice.aggregate.mockResolvedValue([{ _id: null, total }]);
  Invoice.find.mockReturnValue({
    lean: async () => [],
  });
}

describe('Milestone 6.3: NDIS Plan Budget Drawdown & Depletion Warning Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validates invoice with healthy budget: no depletion warning attached', async () => {
    mockClientPlan({ totalBudget: 10000 });
    mockInvoiceConsumed(0); // $0 consumed previously

    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'client123',
      amount: 2000,
      serviceStart: new Date('2026-06-01'),
      serviceEnd: new Date('2026-06-07'),
      lineItems: [
        { supportItemNumber: '01_801_0115_1_1', totalPrice: 2000 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.totalBudget).toBe(10000);
    expect(result.consumed).toBe(0);
    expect(result.remaining).toBe(8000);
    expect(result.remainingPercentage).toBe(80);
    expect(result.budgetWarning).toBeNull();
    expect(result.budgetDrawdown).toBeDefined();
    expect(result.budgetDrawdown.effectiveBudget).toBe(10000);
    expect(result.budgetDrawdown.previousConsumed).toBe(0);
    expect(result.budgetDrawdown.invoiceAmount).toBe(2000);
    expect(result.budgetDrawdown.remainingAfterInvoice).toBe(8000);
    expect(result.budgetDrawdown.remainingPercentage).toBe(80);
  });

  test('attaches BUDGET_DEPLETION_WARNING when remaining budget drops to <= 15%', async () => {
    mockClientPlan({ totalBudget: 10000 });
    mockInvoiceConsumed(8000); // $8,000 previously consumed

    // Invoice for $600:
    // Remaining = 10000 - 8000 - 600 = $1,400 (14.0% remaining <= 15%)
    const result = await planBudgetService.validateInvoiceAgainstPlan({
      organizationId: 'org1',
      clientId: 'client123',
      amount: 600,
      serviceStart: new Date('2026-06-15'),
      serviceEnd: new Date('2026-06-21'),
      lineItems: [
        { supportItemNumber: '01_801_0115_1_1', totalPrice: 600 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.totalBudget).toBe(10000);
    expect(result.consumed).toBe(8000);
    expect(result.remaining).toBe(1400);
    expect(result.remainingPercentage).toBe(14);

    // Warning validation
    expect(result.budgetWarning).not.toBeNull();
    expect(result.budgetWarning.code).toBe('BUDGET_DEPLETION_WARNING');
    expect(result.budgetWarning.remainingPercentage).toBe(14);
    expect(result.budgetWarning.remainingAfter).toBe(1400);
    expect(result.budgetWarning.totalBudget).toBe(10000);
    expect(result.budgetWarning.message).toContain('14.0%');

    // Drawdown metadata
    expect(result.budgetDrawdown).toBeDefined();
    expect(result.budgetDrawdown.effectiveBudget).toBe(10000);
    expect(result.budgetDrawdown.previousConsumed).toBe(8000);
    expect(result.budgetDrawdown.invoiceAmount).toBe(600);
    expect(result.budgetDrawdown.remainingAfterInvoice).toBe(1400);
    expect(result.budgetDrawdown.remainingPercentage).toBe(14);
  });
});
