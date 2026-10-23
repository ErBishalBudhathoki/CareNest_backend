/**
 * Invoice extraction priority: actual worked time wins over the assigned
 * schedule; schedule entries are only used for shifts that were not clocked.
 * This mirrors the Flutter enhanced-invoice processor.
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

const invoiceGenerationService = require('../../services/invoiceGenerationService');

const assignment = {
  _id: 'assignment-1',
  clientEmail: 'client@org.com',
  schedule: [
    { date: '2026-10-01', startTime: '09:00', endTime: '11:00' },
    { date: '2026-10-02', startTime: '09:00', endTime: '11:00' },
  ],
};

const client = { _id: 'client-1', organizationId: 'org-1' };

describe('extractLineItemsFromAssignment — worked time precedence', () => {
  let workedSpy;
  let scheduleSpy;

  beforeEach(() => {
    workedSpy = jest
      .spyOn(invoiceGenerationService, 'createLineItemFromWorkedTime')
      .mockImplementation(async (entry) => ({
        source: 'workedTime',
        date: entry.shiftDate || entry.date,
      }));
    scheduleSpy = jest
      .spyOn(invoiceGenerationService, 'createLineItemFromSchedule')
      .mockImplementation(async (item) => ({
        source: 'schedule',
        date: item.date,
      }));
  });

  afterEach(() => {
    workedSpy.mockRestore();
    scheduleSpy.mockRestore();
  });

  test('bills the clocked shift from worked time and the unclocked one from schedule', async () => {
    const workedTimeData = [
      {
        shiftDate: '2026-10-01',
        shiftStartTime: '09:00',
        timeWorked: '03:00:00',
      },
    ];

    const items = await invoiceGenerationService.extractLineItemsFromAssignment(
      assignment,
      client,
      workedTimeData,
      '2026-10-01',
      '2026-10-02',
    );

    expect(items).toEqual([
      { source: 'workedTime', date: '2026-10-01' },
      { source: 'schedule', date: '2026-10-02' },
    ]);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  test('falls back to the schedule when nothing was clocked', async () => {
    const items = await invoiceGenerationService.extractLineItemsFromAssignment(
      assignment,
      client,
      [],
      '2026-10-01',
      '2026-10-02',
    );

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.source === 'schedule')).toBe(true);
    expect(workedSpy).not.toHaveBeenCalled();
  });

  test('a worked entry without a start time still covers the day', async () => {
    const items = await invoiceGenerationService.extractLineItemsFromAssignment(
      assignment,
      client,
      [{ shiftDate: '2026-10-01', timeWorked: '02:00:00' }],
      '2026-10-01',
      '2026-10-02',
    );

    expect(items.map((item) => item.source)).toEqual([
      'workedTime',
      'schedule',
    ]);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  test('ignores worked entries outside the billing period', async () => {
    const items = await invoiceGenerationService.extractLineItemsFromAssignment(
      assignment,
      client,
      [
        {
          shiftDate: '2026-09-20',
          shiftStartTime: '09:00',
          timeWorked: '02:00:00',
        },
      ],
      '2026-10-01',
      '2026-10-02',
    );

    // The out-of-period worked row must not be billed; both in-range
    // scheduled shifts fall back to the schedule.
    expect(items).toEqual([
      { source: 'schedule', date: '2026-10-01' },
      { source: 'schedule', date: '2026-10-02' },
    ]);
    expect(workedSpy).not.toHaveBeenCalled();
  });
});
