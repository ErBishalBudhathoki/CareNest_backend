'use strict';

/**
 * P0 regression: Temporal retries processRecurringInvoicesActivity. The old
 * implementation used Date.now()/Math.random() for invoiceNumber and did an
 * unconditional insertOne, so every retry double-billed the same period.
 */

const mockCollection = {
  createIndex: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
};

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    topology: { isConnected: () => true },
    connect: jest.fn(),
    db: () => ({ collection: () => mockCollection }),
  })),
  ServerApiVersion: { v1: 1 },
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../services/recurringExpenseService', () => ({
  processRecurringExpenses: jest.fn(),
}));

const {
  processRecurringInvoicesActivity,
  _recurringGenerationKey,
  _isoDay,
} = require('../../temporal/activities/cron');

function parent(overrides = {}) {
  return {
    _id: 'parent-1',
    invoiceNumber: 'INV-PARENT',
    organizationId: 'org-a',
    financialSummary: { paymentTerms: 7, totalAmount: 200, currency: 'AUD' },
    workflow: { status: 'sent' },
    recurrence: {
      isRecurring: true,
      frequency: 'monthly',
      nextDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    },
    metadata: { invoiceType: 'client' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MONGODB_URI = 'mongodb://test';
  mockCollection.createIndex.mockResolvedValue('uniq_invoice_idempotency');
  mockCollection.find.mockReturnValue({ toArray: async () => [parent()] });
  mockCollection.updateOne.mockImplementation(async (filter) =>
    filter._id
      ? { modifiedCount: 1 }
      : { upsertedCount: 1, matchedCount: 0 },
  );
});

describe('processRecurringInvoicesActivity idempotency', () => {
  test('two runs of the same schedule produce one identical bill', async () => {
    const first = await processRecurringInvoicesActivity();
    const firstUpsert = mockCollection.updateOne.mock.calls.find(
      ([filter]) => filter['metadata.idempotencyKey'],
    );

    mockCollection.updateOne.mockImplementation(async (filter) =>
      filter._id
        ? { modifiedCount: 1 }
        : { upsertedCount: 0, matchedCount: 1 },
    );
    const second = await processRecurringInvoicesActivity();
    const secondUpsert = mockCollection.updateOne.mock.calls
      .filter(([filter]) => filter['metadata.idempotencyKey'])
      .pop();

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(mockCollection.insertOne).not.toHaveBeenCalled();

    expect(secondUpsert[0]['metadata.idempotencyKey']).toBe(
      firstUpsert[0]['metadata.idempotencyKey'],
    );
    expect(secondUpsert[1].$setOnInsert.invoiceNumber).toBe(
      firstUpsert[1].$setOnInsert.invoiceNumber,
    );
    expect(firstUpsert[1].$setOnInsert.invoiceNumber).toMatch(
      /^INV-R-parent-1-20260101$/,
    );
    expect(firstUpsert[1].$setOnInsert._id).toBeUndefined();
    expect(firstUpsert[1].$setOnInsert.metadata.idempotencyKey).toBe(
      'recurring:parent-1:2026-01-01',
    );
    expect(firstUpsert[2]).toEqual({ upsert: true });
  });

  test('a unique sparse idempotency index is requested', async () => {
    await processRecurringInvoicesActivity();
    expect(mockCollection.createIndex).toHaveBeenCalledWith(
      { 'metadata.idempotencyKey': 1 },
      expect.objectContaining({ unique: true, sparse: true }),
    );
  });

  test('an unknown frequency is skipped instead of billing the same period forever', async () => {
    mockCollection.find.mockReturnValue({
      toArray: async () => [
        parent({ recurrence: { ...parent().recurrence, frequency: 'biweekly' } }),
      ],
    });
    const result = await processRecurringInvoicesActivity();
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });

  test('generation key is stable across timezones and independent of clock', () => {
    const p = parent();
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(_isoDay(d)).toBe('2026-01-01');
    expect(_recurringGenerationKey(p, d)).toBe('recurring:parent-1:2026-01-01');
    expect(_recurringGenerationKey(p, new Date(d.getTime() + 1000))).toBe(
      _recurringGenerationKey(p, d),
    );
  });
});
