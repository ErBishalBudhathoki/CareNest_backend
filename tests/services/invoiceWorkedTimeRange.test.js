/**
 * Worked-time range query used when an invoice falls back to actual hours.
 *
 * The previous query compared against midnight of the end date, so anything
 * logged on the final day of the billing period was silently excluded. Dates
 * were also parsed with `new Date()`, which reads DD/MM/YYYY as MM/DD.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClientAssignment', () => ({}));
jest.mock('../../models/Client', () => ({}));
jest.mock('../../models/WorkedTime', () => ({ find: jest.fn() }));
jest.mock('../../models/Expense', () => ({}));
jest.mock('../../models/CustomPricing', () => ({}));
jest.mock('../../models/PricingSettings', () => ({}));
jest.mock('../../models/SupportItem', () => ({}));
jest.mock('../../models/Organization', () => ({}));
jest.mock('../../services/priceValidationService', () => ({ priceValidationService: {} }));
jest.mock('../../services/tripService', () => ({}));

const WorkedTime = require('../../models/WorkedTime');
const dateHelpers = require('../../utils/dateHelpers');
const invoiceGenerationService = require('../../services/invoiceGenerationService');

describe('invoiceGenerationService.getWorkedTimeData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    WorkedTime.find.mockResolvedValue([]);
  });

  test('queries the whole first and last day (day-first dates)', async () => {
    await invoiceGenerationService.getWorkedTimeData(
      'worker@org.com',
      'client@org.com',
      '01/10/2026',
      '31/10/2026',
    );

    const query = WorkedTime.find.mock.calls[0][0];
    const expectedStart = dateHelpers.startOfDay(new Date(2026, 9, 1));
    const expectedEnd = dateHelpers.endOfDay(new Date(2026, 9, 31));

    expect(query.userEmail).toBe('worker@org.com');
    expect(query.clientEmail).toBe('client@org.com');
    expect(query.date.$gte.getTime()).toBe(expectedStart.getTime());
    expect(query.date.$lte.getTime()).toBe(expectedEnd.getTime());
    // The last day must be included, not midnight at its start.
    expect(query.date.$lte.getHours()).toBe(23);
    expect(query.date.$lte.getMinutes()).toBe(59);
  });

  test('accepts ISO bounds', async () => {
    await invoiceGenerationService.getWorkedTimeData(
      'worker@org.com',
      'client@org.com',
      '2026-10-01',
      '2026-10-31',
    );

    const query = WorkedTime.find.mock.calls[0][0];
    expect(query.date.$gte.getTime()).toBe(
      dateHelpers.startOfDay(new Date(2026, 9, 1)).getTime(),
    );
    expect(query.date.$lte.getTime()).toBe(
      dateHelpers.endOfDay(new Date(2026, 9, 31)).getTime(),
    );
  });

  test('returns an empty list for invalid bounds instead of querying', async () => {
    const rows = await invoiceGenerationService.getWorkedTimeData(
      'worker@org.com',
      'client@org.com',
      'not-a-date',
      '31/10/2026',
    );

    expect(rows).toEqual([]);
    expect(WorkedTime.find).not.toHaveBeenCalled();
  });
});
