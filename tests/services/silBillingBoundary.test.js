/**
 * P0 regression: standard Invoice Operations must NEVER pick up SIL hours.
 *
 * SIL hours are invoiced by SIL Management / NDIS Claiming. A WorkedTime row
 * linked to a SIL Shift (`silShiftId`) and a Shift materialised from a roster
 * of care (`silRosterOfCareId`) are the same hours; letting the standard path
 * read them bills the client twice.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockClientFindOne = jest.fn();
const mockAssignmentFindOne = jest.fn();
const mockWorkedTimeFind = jest.fn();
const mockShiftFind = jest.fn();

jest.mock('../../models/ClientAssignment', () => ({
  findOne: (...args) => mockAssignmentFindOne(...args),
}));
jest.mock('../../models/Client', () => ({
  findOne: (...args) => mockClientFindOne(...args),
}));
jest.mock('../../models/WorkedTime', () => ({
  find: (...args) => mockWorkedTimeFind(...args),
}));
jest.mock('../../models/Shift', () => ({
  find: (...args) => mockShiftFind(...args),
}));
jest.mock('../../models/Expense', () => ({}));
jest.mock('../../models/CustomPricing', () => ({}));
jest.mock('../../models/PricingSettings', () => ({}));
jest.mock('../../models/SupportItem', () => ({}));
jest.mock('../../models/Organization', () => ({}));
jest.mock('../../services/priceValidationService', () => ({ priceValidationService: {} }));
jest.mock('../../services/tripService', () => ({}));

const {
  STANDARD_WORKED_TIME_EXCLUSIONS,
  STANDARD_SHIFT_EXCLUSIONS,
  isSilWorkedTime,
  isSilShift,
  findOrphanSilWorkedTimeIds,
} = require('../../utils/silBillingBoundary');
const invoiceGenerationService = require('../../services/invoiceGenerationService');

describe('SIL billing boundary helpers', () => {
  test('a WorkedTime row linked to a SIL Shift is SIL work', () => {
    expect(isSilWorkedTime({ silShiftId: 'shift-1' })).toBe(true);
    expect(isSilWorkedTime({ isIrregularSil: true })).toBe(true);
    expect(isSilWorkedTime({ isIrregularSil: false })).toBe(false);
    expect(isSilWorkedTime({})).toBe(false);
    expect(isSilWorkedTime(null)).toBe(false);
  });

  test('a Shift materialised from a roster of care is SIL work', () => {
    expect(isSilShift({ silRosterOfCareId: 'roc-1' })).toBe(true);
    expect(isSilShift({ isIrregularSil: true })).toBe(true);
    expect(isSilShift({})).toBe(false);
    expect(isSilShift(null)).toBe(false);
  });

  test('exclusion predicates match legacy rows where the field is absent', () => {
    // Mongo `{field: null}` matches both missing and explicitly-null fields.
    expect(STANDARD_WORKED_TIME_EXCLUSIONS.silShiftId).toBeNull();
    expect(STANDARD_SHIFT_EXCLUSIONS.silRosterOfCareId).toBeNull();
    expect(STANDARD_WORKED_TIME_EXCLUSIONS.isIrregularSil).toEqual({ $ne: true });
    expect(STANDARD_SHIFT_EXCLUSIONS.isIrregularSil).toEqual({ $ne: true });
  });
});

describe('unresolved SIL links must not silently drop ordinary hours', () => {
  test('a link to a genuine SIL shift stays excluded from standard invoicing', () => {
    const rows = [
      { _id: 'wt-1', silShiftId: 'shift-1' },
      { _id: 'wt-2', silShiftId: 'shift-2' },
    ];
    const shifts = [
      { _id: 'shift-1', silRosterOfCareId: 'roc-1' },
      { _id: 'shift-2', isIrregularSil: true },
    ];
    expect(findOrphanSilWorkedTimeIds(rows, shifts)).toEqual([]);
  });

  test('a deleted shift and a non-SIL shift are recovered', () => {
    const rows = [
      { _id: 'wt-1', silShiftId: 'shift-deleted' },
      { _id: 'wt-2', silShiftId: 'shift-plain' },
      { _id: 'wt-3', silShiftId: 'shift-1' },
    ];
    const shifts = [
      { _id: 'shift-1', silRosterOfCareId: 'roc-1' },
      { _id: 'shift-plain' }, // a normal Shift, never materialised from a roster
    ];
    expect(findOrphanSilWorkedTimeIds(rows, shifts))
      .toEqual(['wt-1', 'wt-2']);
  });

  test('a missing silShiftId is orphaned; irregular SIL is always left to SIL billing', () => {
    const rows = [
      { _id: 'wt-1', isIrregularSil: true },
      { _id: 'wt-2', isIrregularSil: true, silShiftId: null },
      { _id: 'wt-3', isIrregularSil: false },
    ];
    expect(findOrphanSilWorkedTimeIds(rows, [])).toEqual(['wt-3']);
  });

  test('empty inputs are safe', () => {
    expect(findOrphanSilWorkedTimeIds()).toEqual([]);
    expect(findOrphanSilWorkedTimeIds([], [])).toEqual([]);
  });
});

describe('standard invoice data access excludes SIL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkedTimeFind.mockResolvedValue([]);
    mockShiftFind.mockResolvedValue([]);
    mockAssignmentFindOne.mockResolvedValue(null);
    mockClientFindOne.mockResolvedValue({
      _id: 'client-1',
      organizationId: 'org-1',
      clientEmail: 'client@org.com',
    });
  });

  test('getWorkedTimeData filters out SIL-linked and irregular-SIL hours', async () => {
    await invoiceGenerationService.getWorkedTimeData(
      'worker@org.com',
      'client@org.com',
      '2026-10-01',
      '2026-10-31',
    );

    const query = mockWorkedTimeFind.mock.calls[0][0];
    expect(query).toMatchObject({
      silShiftId: null,
      isIrregularSil: { $ne: true },
    });
  });

  test('getWorkedTimeData recovers hours whose SIL link no longer resolves', async () => {
    const standardRow = { _id: 'wt-std', totalHours: 2 };
    const orphanRow = { _id: 'wt-orphan', totalHours: 3 };
    mockWorkedTimeFind
      // 1) standard query (SIL rows excluded)
      .mockResolvedValueOnce([standardRow])
      // 2) SIL-linked rows in the same period
      .mockResolvedValueOnce([
        { _id: 'wt-orphan', silShiftId: 'shift-deleted', isIrregularSil: false },
        { _id: 'wt-sil', silShiftId: 'shift-1', isIrregularSil: false },
      ])
      // 3) recovered orphan rows
      .mockResolvedValueOnce([orphanRow]);
    mockShiftFind.mockResolvedValueOnce([
      { _id: 'shift-1', silRosterOfCareId: 'roc-1' },
    ]);

    const rows = await invoiceGenerationService.getWorkedTimeData(
      'worker@org.com',
      'client@org.com',
      '2026-10-01',
      '2026-10-31',
    );

    expect(rows.map((row) => row._id)).toEqual(['wt-std', 'wt-orphan']);
    expect(mockWorkedTimeFind).toHaveBeenCalledTimes(3);
    expect(mockWorkedTimeFind.mock.calls[2][0]._id)
      .toEqual({ $in: ['wt-orphan'] });
    // The genuine SIL link is still excluded, so no double-billing.
    expect(mockWorkedTimeFind.mock.calls[0][0]).toMatchObject({
      silShiftId: null,
      isIrregularSil: { $ne: true },
    });
  });

  test('the Shift fallback cannot be satisfied by a SIL roster shift', async () => {
    jest.spyOn(invoiceGenerationService, 'extractLineItemsFromAssignment')
      .mockResolvedValue([]);
    jest.spyOn(invoiceGenerationService, 'getBillableTripsForInvoice')
      .mockResolvedValue([]);
    jest.spyOn(invoiceGenerationService, 'validateInvoiceLineItems')
      .mockResolvedValue({ isValid: true, errors: [], warnings: [] });

    // No assignment, no worked time -> the Shift fallback runs and, with no
    // standard shifts available, must refuse to generate a standard invoice.
    await expect(
      invoiceGenerationService.generateInvoiceLineItems(
        'worker@org.com',
        'client@org.com',
        '2026-10-01',
        '2026-10-31',
      ),
    ).rejects.toThrow('No active assignment or shifts found');

    const shiftQuery = mockShiftFind.mock.calls[0][0];
    expect(shiftQuery).toMatchObject({
      silRosterOfCareId: null,
      isIrregularSil: { $ne: true },
    });
  });
});
