/**
 * SIL → billing wiring (Phase 4 → Phase 6): an active roster-of-care is
 * prorated over a period into a client invoice, inheriting the participant's
 * funding route. Models and the invoice service are mocked.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockRocFindOne = jest.fn();
jest.mock('../../models/SILRosterOfCare', () => ({
  findOne: (...args) => mockRocFindOne(...args),
}));

const mockClientFindOne = jest.fn();
jest.mock('../../models/Client', () => ({
  findOne: (...args) => mockClientFindOne(...args),
}));

const mockInvoiceFindOne = jest.fn();
jest.mock('../../models/Invoice', () => ({
  Invoice: { findOne: (...args) => mockInvoiceFindOne(...args) },
}));

const mockShiftFind = jest.fn();
jest.mock('../../models/Shift', () => ({
  find: (...args) => mockShiftFind(...args),
}));

const mockWorkedTimeFind = jest.fn();
jest.mock('../../models/WorkedTime', () => ({
  find: (...args) => mockWorkedTimeFind(...args),
}));

const mockGenerateInvoiceNumber = jest.fn();
const mockCreateInvoice = jest.fn();
// Mirror the real module shape: it exports the instance under
// `InvoiceManagementService`, not the methods directly.
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    generateInvoiceNumber: (...args) => mockGenerateInvoiceNumber(...args),
    createInvoice: (...args) => mockCreateInvoice(...args),
  },
}));

const silBillingService = require('../../services/silBillingService');

const noExistingInvoice = () =>
  mockInvoiceFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

const activeRoc = {
  _id: 'roc1',
  clientId: 'c1',
  status: 'active',
  supports: [
    { supportNumber: '01_011_0107_1_1', supportName: 'Daily living', hoursPerWeek: 10, unitPrice: 70 },
    { supportNumber: '01_015_0107_1_1', supportName: 'Community', hoursPerWeek: 5, unitPrice: 60 },
  ],
};

describe('SILBillingService.generateInvoiceFromRosterOfCare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRocFindOne.mockResolvedValue(activeRoc);
    mockClientFindOne.mockReturnValue({
      lean: async () => ({
        clientFirstName: 'Ada',
        clientLastName: 'Nguyen',
        clientEmail: 'ada@example.com',
      }),
    });
    noExistingInvoice();
    mockShiftFind.mockReturnValue({
      lean: async () => [],
    });
    mockWorkedTimeFind.mockReturnValue({
      lean: async () => [],
    });
    mockGenerateInvoiceNumber.mockResolvedValue('INVORG6101AN');
    mockCreateInvoice.mockImplementation(async (data) => ({
      success: true,
      data: {
        ...data,
        _id: 'inv1',
        billing: { fundingType: 'ndia_managed', recipientType: 'ndia', artifact: 'claim_csv' },
      },
    }));
  });

  test('prorates weekly supports over the period into invoice line items', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
      'admin@org.com',
    );

    // 14 inclusive days = 2 weeks.
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems).toHaveLength(2);
    expect(payload.lineItems[0]).toMatchObject({
      supportItemNumber: '01_011_0107_1_1',
      quantity: 20, // 10h/wk × 2 weeks
      price: 70,
      unit: 'H',
      totalPrice: 1400,
    });
    expect(payload.lineItems[1]).toMatchObject({ quantity: 10, totalPrice: 600 });
    // NDIS supports are GST-free.
    expect(payload.financialSummary).toMatchObject({ subtotal: 2000, taxAmount: 0, totalAmount: 2000 });
    expect(payload.metadata).toMatchObject({
      invoiceType: 'client',
      generationMethod: 'sil_roster_of_care',
    });
    // Addressed to the participant using the canonical Client name fields.
    expect(payload.clientName).toBe('Ada Nguyen');
    expect(payload.clientEmail).toBe('ada@example.com');
  });

  test('bills a sleepover as a fixed fee per shift, not hours', async () => {
    mockRocFindOne.mockResolvedValue({
      ...activeRoc,
      supports: [
        {
          supportNumber: '01_002_0107_1_1',
          supportName: 'Sleepover',
          shiftType: 'sleepover',
          hoursPerWeek: 56,
          unitPrice: 311.79,
          days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        },
      ],
    });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
      'admin@org.com',
    );

    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems[0]).toMatchObject({
      quantity: 14, // 7 sleepovers × 2 weeks
      unit: 'E',
      price: 311.79,
      totalPrice: 4365.06,
    });
    expect(payload.financialSummary.totalAmount).toBe(4365.06);
  });

  test('surfaces the funding route stamped on the created invoice', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );

    expect(result.billing).toMatchObject({ fundingType: 'ndia_managed', artifact: 'claim_csv' });
  });

  test('is idempotent — refuses to re-bill the same RoC for the same period', async () => {
    mockInvoiceFindOne.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: 'inv-existing', invoiceNumber: 'INV-1' }) }),
    });

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );

    expect(result.conflict).toBe(true);
    expect(result.existingInvoiceId).toBe('inv-existing');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('rejects a roster of care that is not active', async () => {
    mockRocFindOne.mockResolvedValue({ ...activeRoc, status: 'ended' });
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );
    expect(result.invalidState).toBe(true);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('rejects an invalid period', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-14', to: '2026-04-01' },
    );
    expect(result.invalidPeriod).toBe(true);
  });

  test('returns notFound for an unknown roster of care', async () => {
    mockRocFindOne.mockResolvedValue(null);
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'missing',
      { from: '2026-04-01', to: '2026-04-14' },
    );
    expect(result.notFound).toBe(true);
  });

  test('rejects a period with no billable supports', async () => {
    mockRocFindOne.mockResolvedValue({
      ...activeRoc,
      supports: [{ supportNumber: 'x', hoursPerWeek: 0, unitPrice: 70 }],
    });
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );
    expect(result.invalidState).toBe(true);
  });

  test('reconciles actual WorkedTime hours against RoC quota and appends variance line item when actual > planned', async () => {
    const shift1Id = 'shift-sil-1';
    mockShiftFind.mockReturnValue({
      lean: async () => [
        {
          _id: shift1Id,
          silRosterOfCareId: 'roc1',
          supportItems: [{ itemNumber: '01_011_0107_1_1', itemName: 'Daily living' }],
        },
      ],
    });

    // Planned: 10h/week × 2 weeks = 20h.
    // Actual worked: 25 hours (5h variance).
    mockWorkedTimeFind.mockReturnValue({
      lean: async () => [
        {
          silShiftId: shift1Id,
          ndisItemNumber: '01_011_0107_1_1',
          totalHours: 25,
        },
      ],
    });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'reconciled' },
      'admin@org.com',
    );

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];

    // Should have 3 line items:
    // 1) Planned Daily Living: 20h @ $70 = $1400
    // 2) Planned Community: 10h @ $60 = $600
    // 3) Variance Daily Living (appended): 5h @ $70 = $350
    expect(payload.lineItems).toHaveLength(3);
    const varianceLine = payload.lineItems[2];
    expect(varianceLine).toMatchObject({
      supportItemNumber: '01_011_0107_1_1',
      supportItemName: 'Daily living (Unplanned / Variance Hours)',
      quantity: 5,
      unit: 'H',
      price: 70,
      totalPrice: 350,
    });
    expect(payload.financialSummary.totalAmount).toBe(2350); // 1400 + 600 + 350
    expect(payload.metadata.silBillingMode).toBe('reconciled');
    expect(payload.metadata.silReconciliation).toEqual({
      plannedHours: 30, // 20 + 10
      actualHours: 25,
      varianceHours: 5,
    });
  });

  test('mode: reconciled — adds no variance items when actual hours do not exceed planned', async () => {
    const shift1Id = 'shift-sil-1';
    mockShiftFind.mockReturnValue({
      lean: async () => [
        {
          _id: shift1Id,
          silRosterOfCareId: 'roc1',
          supportItems: [{ itemNumber: '01_011_0107_1_1', itemName: 'Daily living' }],
        },
      ],
    });

    mockWorkedTimeFind.mockReturnValue({
      lean: async () => [
        {
          silShiftId: shift1Id,
          totalHours: 18, // Planned was 20h, so no variance
          isActive: true,
        },
      ],
    });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'reconciled' },
      'admin@org.com',
    );

    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems).toHaveLength(2); // Only the planned items
    expect(payload.financialSummary.totalAmount).toBe(2000);
    expect(payload.metadata.silReconciliation).toEqual({
      plannedHours: 30,
      actualHours: 18,
      varianceHours: 0,
    });
  });

  test('bills exact clocked hours in verified_timesheet mode', async () => {
    const shift1Id = 'shift-sil-1';
    const shift2Id = 'shift-sil-2';
    mockShiftFind.mockReturnValue({
      lean: async () => [
        { _id: shift1Id, supportItems: [{ itemNumber: '01_011_0107_1_1' }] },
        { _id: shift2Id, supportItems: [{ itemNumber: '01_015_0107_1_1' }] },
      ],
    });

    mockWorkedTimeFind.mockReturnValue({
      lean: async () => [
        { shiftId: shift1Id, totalHours: 12 }, // links via shiftId
        { silShiftId: shift2Id, timeWorked: '06:00:00' }, // 6h via timeWorked string
      ],
    });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'verified_timesheet' },
      'admin@org.com',
    );

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems).toHaveLength(2);
    expect(payload.lineItems[0]).toMatchObject({
      supportItemNumber: '01_011_0107_1_1',
      quantity: 12,
      price: 70,
      unit: 'H',
      totalPrice: 840,
    });
    expect(payload.lineItems[1]).toMatchObject({
      supportItemNumber: '01_015_0107_1_1',
      quantity: 6,
      price: 60,
      unit: 'H',
      totalPrice: 360,
    });
    expect(payload.financialSummary.totalAmount).toBe(1200); // 840 + 360
    expect(payload.metadata.silBillingMode).toBe('verified_timesheet');
    expect(payload.metadata.silReconciliation).toBeUndefined();

    // Verify exact queries used to find shifts and worked times
    expect(mockShiftFind).toHaveBeenCalledWith({
      organizationId: 'org1',
      silRosterOfCareId: 'roc1',
      startTime: {
        $gte: new Date(Date.UTC(2026, 3, 1)),
        $lte: new Date(Date.UTC(2026, 3, 14)),
      },
      isActive: { $ne: false },
    });
    expect(mockWorkedTimeFind).toHaveBeenCalledWith({
      $or: [
        { silShiftId: { $in: [shift1Id, shift2Id] } },
        { shiftId: { $in: [shift1Id, shift2Id] } },
      ],
      isActive: { $ne: false },
    });
  });

  test('mode: roc_quota — does not query Shift or WorkedTime', async () => {
    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'roc_quota' },
      'admin@org.com',
    );

    expect(mockShiftFind).not.toHaveBeenCalled();
    expect(mockWorkedTimeFind).not.toHaveBeenCalled();
  });
});

describe('SILBillingService.inclusiveDays', () => {
  test('counts both endpoints', () => {
    expect(
      silBillingService.inclusiveDays(new Date('2026-04-01'), new Date('2026-04-01')),
    ).toBe(1);
    expect(
      silBillingService.inclusiveDays(new Date('2026-04-01'), new Date('2026-04-14')),
    ).toBe(14);
  });
});
