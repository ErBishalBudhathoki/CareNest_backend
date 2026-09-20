/**
 * Recurring-expense Temporal wiring: activity delegates to the existing
 * service, workflow is registered, and failures propagate for retries.
 */
const mockProcessRecurringExpenses = jest.fn();
jest.mock('../../services/recurringExpenseService', () => ({
  processRecurringExpenses: (...args) =>
    mockProcessRecurringExpenses(...args),
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const {
  processRecurringExpensesActivity,
} = require('../../temporal/activities/cron');
const {
  RecurringExpenseCronWorkflow,
} = require('../../temporal/workflows/cron');
const workflowIndex = require('../../temporal/workflows/index');

describe('processRecurringExpensesActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('processes all orgs and summarizes results', async () => {
    mockProcessRecurringExpenses.mockResolvedValue({
      processed: 5,
      created: 3,
      updated: 0,
      errors: [],
      details: [],
    });
    const result = await processRecurringExpensesActivity();
    expect(mockProcessRecurringExpenses).toHaveBeenCalledWith(null);
    expect(result).toEqual({ processed: 5, created: 3, errorCount: 0 });
  });

  test('counts service errors without swallowing the failure signal', async () => {
    mockProcessRecurringExpenses.mockResolvedValue({
      processed: 2,
      created: 1,
      errors: [{ expenseId: 'x', error: 'boom' }],
      details: [],
    });
    const result = await processRecurringExpensesActivity();
    expect(result).toEqual({ processed: 2, created: 1, errorCount: 1 });
  });

  test('rethrows unexpected failures so Temporal retries', async () => {
    mockProcessRecurringExpenses.mockRejectedValue(new Error('db down'));
    await expect(processRecurringExpensesActivity()).rejects.toThrow(
      'db down',
    );
  });
});

describe('RecurringExpenseCronWorkflow registration', () => {
  test('workflow is exported for the worker bundle', () => {
    expect(typeof RecurringExpenseCronWorkflow).toBe('function');
    expect(workflowIndex.RecurringExpenseCronWorkflow).toBe(
      RecurringExpenseCronWorkflow,
    );
  });
});
