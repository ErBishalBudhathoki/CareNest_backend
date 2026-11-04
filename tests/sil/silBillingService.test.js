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

const mockPropertyFindOne = jest.fn();
jest.mock('../../models/SILProperty', () => ({
  findOne: (...args) => mockPropertyFindOne(...args),
}));

const mockGetMmmByPostcode = jest.fn();
const mockGetMultiplierForMmm = jest.fn();
jest.mock('../../services/mmmService', () => ({
  mmmService: {
    getMmmByPostcode: (...args) => mockGetMmmByPostcode(...args),
    getMultiplierForMmm: (...args) => mockGetMultiplierForMmm(...args),
  },
}));

const mockShiftFind = jest.fn();
jest.mock('../../models/Shift', () => ({
  find: (...args) => mockShiftFind(...args),
}));

const mockSupportItemFindOne = jest.fn();
jest.mock('../../models/SupportItem', () => ({
  findOne: (...args) => mockSupportItemFindOne(...args),
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
    mockPropertyFindOne.mockReturnValue({
      lean: async () => null,
    });
    mockGetMmmByPostcode.mockResolvedValue(null);
    mockGetMultiplierForMmm.mockImplementation((mmm) => (mmm === 6 ? 1.4 : mmm === 7 ? 1.5 : 1.0));
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
        $lt: new Date(Date.UTC(2026, 3, 15)),
      },
      isActive: { $ne: false },
    });
    expect(mockWorkedTimeFind).toHaveBeenCalledWith({
      organizationId: 'org1',
      $or: [
        { silShiftId: { $in: [shift1Id, shift2Id] } },
        { shiftId: { $in: [shift1Id, shift2Id] } },
      ],
      isActive: { $ne: false },
    });
  });

  test('parses Australian DD/MM/YYYY date strings correctly without swapping day/month', async () => {
    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '01/04/2026', to: '14/04/2026', mode: 'roc_quota' },
      'admin@org.com',
    );

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.metadata.silPeriod.from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(payload.metadata.silPeriod.to.toISOString()).toBe('2026-04-14T00:00:00.000Z');
  });

  test('rejects an invalid billing mode', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'invalid_mode' },
      'admin@org.com',
    );

    expect(result.invalidPeriod).toBe(true);
    expect(result.message).toContain("Invalid billing mode 'invalid_mode'");
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

  // Milestone 4.1: Regional MMM Price Loading
  test('applies MMM 6 regional loading (1.4x) when property is in Remote location', async () => {
    mockRocFindOne.mockResolvedValue({
      ...activeRoc,
      propertyId: 'propRemote1',
    });
    mockPropertyFindOne.mockReturnValue({
      lean: async () => ({
        _id: 'propRemote1',
        name: 'Broome SIL House',
        address: { postcode: '6725', suburb: 'Broome', state: 'WA' },
      }),
    });
    mockGetMmmByPostcode.mockResolvedValue({ mmm: 6, source: 'NDIA MMM' });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'roc_quota' },
      'admin@org.com',
    );

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];

    // Daily living: base $70 * 1.4 = $98.00; Community: base $60 * 1.4 = $84.00
    expect(payload.lineItems[0].price).toBe(98);
    expect(payload.lineItems[0].totalPrice).toBe(1960); // 20h * $98
    expect(payload.lineItems[0].serviceLocationPostcode).toBe('6725');
    expect(payload.lineItems[0].pricingMetadata).toMatchObject({
      mmmRating: 6,
      mmmMultiplier: 1.4,
      baseUnitPrice: 70,
      appliedUnitPrice: 98,
    });

    expect(payload.lineItems[1].price).toBe(84);
    expect(payload.lineItems[1].totalPrice).toBe(840); // 10h * $84

    expect(payload.financialSummary.totalAmount).toBe(2800);
    expect(payload.metadata.serviceLocationPostcode).toBe('6725');
    expect(payload.metadata.mmmRating).toBe(6);
    expect(payload.metadata.mmmMultiplier).toBe(1.4);
    expect(payload.metadata.internalNotes).toContain('MMM 6 regional multiplier: 1.4x');
  });

  test('applies MMM 7 regional loading (1.5x) when participant address postcode falls back', async () => {
    mockRocFindOne.mockResolvedValue({
      ...activeRoc,
      propertyId: null, // No property
    });
    mockClientFindOne.mockReturnValue({
      lean: async () => ({
        clientFirstName: 'Bessie',
        clientLastName: 'Barker',
        clientEmail: 'bessie@example.com',
        clientZip: '0872', // Very remote NT
      }),
    });
    mockGetMmmByPostcode.mockResolvedValue({ mmm: 7, source: 'NDIA MMM' });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'roc_quota' },
      'admin@org.com',
    );

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];

    // Daily living: base $70 * 1.5 = $105.00
    expect(payload.lineItems[0].price).toBe(105);
    expect(payload.lineItems[0].totalPrice).toBe(2100); // 20h * $105
    expect(payload.lineItems[0].serviceLocationPostcode).toBe('0872');
    expect(payload.lineItems[0].pricingMetadata).toMatchObject({
      mmmRating: 7,
      mmmMultiplier: 1.5,
      baseUnitPrice: 70,
      appliedUnitPrice: 105,
    });

    expect(payload.financialSummary.totalAmount).toBe(3000); // (20*105) + (10*90) = 2100 + 900
    expect(payload.metadata.serviceLocationPostcode).toBe('0872');
    expect(payload.metadata.mmmRating).toBe(7);
    expect(payload.metadata.mmmMultiplier).toBe(1.5);
  });

  // Milestone 4.3: Irregular SIL, Crisis Staffing & PRN Support Billing
  test('mode: verified_timesheet — generates irregular SIL claim lines with PACE crisis justification notes and incident report reference', async () => {
    mockRocFindOne.mockResolvedValue(activeRoc);

    // Regular shifts and worked times:
    const regularShift = { _id: 's1', silRosterOfCareId: 'roc1', isActive: true, isIrregularSil: false };
    const irregularShift = {
      _id: 'sCrisis1',
      silRosterOfCareId: 'roc1',
      clientId: 'c1',
      isActive: true,
      isIrregularSil: true,
      irregularSilReason: 'crisis',
      crisisJustificationNotes: 'Participant experienced acute behavioral escalation requiring emergency 1:1 staffing',
      incidentReportReference: 'INC-2026-04-0012',
      startTime: new Date('2026-04-05T10:00:00.000Z'),
      endTime: new Date('2026-04-05T14:00:00.000Z'),
      breakDuration: 0,
    };

    mockShiftFind.mockImplementation((query) => {
      if (query.isIrregularSil || (Array.isArray(query.$or) && query.$or.some((c) => c.isIrregularSil))) {
        return {
          lean: async () => [irregularShift],
        };
      }
      return {
        lean: async () => [regularShift],
      };
    });

    const regularWt = {
      _id: 'wt1',
      silShiftId: 's1',
      supportNumber: '01_011_0107_1_1',
      totalHours: 10,
      isActive: true,
      isIrregularSil: false,
    };

    const irregularWt = {
      _id: 'wtCrisis1',
      silShiftId: 'sCrisis1',
      totalHours: 4,
      isActive: true,
      isIrregularSil: true,
    };

    mockWorkedTimeFind.mockImplementation((query) => {
      if (Array.isArray(query.$or) && query.$or.some((c) => c.silShiftId?.$in?.includes('sCrisis1'))) {
        return {
          lean: async () => [irregularWt],
        };
      }
      return {
        lean: async () => [regularWt],
      };
    });

    await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'verified_timesheet' },
      'admin@org.com',
    );

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];

    // 1 regular line + 1 irregular crisis line
    expect(payload.lineItems).toHaveLength(2);

    const regularItem = payload.lineItems[0];
    expect(regularItem).toMatchObject({
      supportItemNumber: '01_011_0107_1_1',
      quantity: 10,
      price: 70,
      totalPrice: 700,
    });

    const irregularItem = payload.lineItems[1];
    expect(irregularItem).toMatchObject({
      supportItemNumber: '01_451_0107_1_1',
      supportItemName: 'Irregular SIL / Crisis Staffing (CRISIS)',
      quantity: 4,
      unit: 'H',
      claimType: 'irregular_sil',
      totalPrice: 280, // 4h @ $70
    });
    expect(irregularItem.pricingMetadata).toMatchObject({
      isIrregularSil: true,
      irregularSilReason: 'crisis',
      crisisJustificationNotes: 'Participant experienced acute behavioral escalation requiring emergency 1:1 staffing',
      incidentReportReference: 'INC-2026-04-0012',
    });

    expect(payload.metadata.irregularSilEvents).toHaveLength(1);
    expect(payload.metadata.irregularSilEvents[0]).toMatchObject({
      shiftId: 'sCrisis1',
      hours: 4,
      reason: 'crisis',
      crisisJustificationNotes: 'Participant experienced acute behavioral escalation requiring emergency 1:1 staffing',
      incidentReportReference: 'INC-2026-04-0012',
      totalPrice: 280,
    });
    expect(payload.metadata.internalNotes).toContain('1 irregular SIL crisis events billed');
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

describe('SILBillingService — crisis rate resolution (M4.3)', () => {
  const rocWithoutPricedSupport = {
    ...activeRoc,
    supports: [{ ...activeRoc.supports[0], unitPrice: 0 }, activeRoc.supports[1]],
  };

  const irregularShift = {
    _id: 'sCrisis1',
    silRosterOfCareId: 'roc1',
    clientId: 'c1',
    isActive: true,
    isIrregularSil: true,
    irregularSilReason: 'crisis',
    crisisJustificationNotes: 'Acute behaviour escalation',
    incidentReportReference: 'INC-2026-04-0012',
    startTime: new Date('2026-04-05T10:00:00.000Z'),
    endTime: new Date('2026-04-05T14:00:00.000Z'),
    breakDuration: 0,
  };

  const irregularWt = {
    _id: 'wtCrisis1',
    silShiftId: 'sCrisis1',
    totalHours: 4,
    isActive: true,
    isIrregularSil: true,
  };

  const crisISUPPORT_QUERY = expect.objectContaining({
    supportItemNumber: '01_451_0107_1_1',
  });

  const armIrregularScenario = () => {
    mockRocFindOne.mockResolvedValue(rocWithoutPricedSupport);
    mockShiftFind.mockImplementation((query) => {
      if (query.isIrregularSil || (Array.isArray(query?.$or) && query.$or.some((c) => c.isIrregularSil))) {
        return { lean: async () => [irregularShift] };
      }
      return { lean: async () => [] };
    });
    mockWorkedTimeFind.mockImplementation((query) => {
      if (Array.isArray(query?.$or) && query.$or.some((c) => c.silShiftId?.$in?.includes('sCrisis1'))) {
        return { lean: async () => [irregularWt] };
      }
      return { lean: async () => [] };
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClientFindOne.mockReturnValue({
      lean: async () => ({
        clientFirstName: 'Ada',
        clientLastName: 'Nguyen',
        clientEmail: 'ada@example.com',
      }),
    });
    noExistingInvoice();
    mockPropertyFindOne.mockReturnValue({ lean: async () => null });
    mockGetMmmByPostcode.mockResolvedValue(null);
    mockGetMultiplierForMmm.mockImplementation((mmm) => (mmm === 6 ? 1.4 : mmm === 7 ? 1.5 : 1.0));
    mockGenerateInvoiceNumber.mockResolvedValue('INVORG6101AN');
    mockCreateInvoice.mockImplementation(async (data) => ({
      success: true,
      data: {
        ...data,
        _id: 'inv-crisis',
        billing: { fundingType: 'ndia_managed', recipientType: 'ndia', artifact: 'claim_csv' },
      },
    }));
    armIrregularScenario();
  });

  const generateCrisisInvoice = () =>
    silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14', mode: 'verified_timesheet' },
      'admin@org.com',
    );

  const crisisLineOf = () => {
    const payload = mockCreateInvoice.mock.calls[0][0];
    return payload.lineItems.find((item) => item.supportItemNumber === '01_451_0107_1_1');
  };

  test('uses the active NDIS catalogue price when the RoC carries no priced support', async () => {
    mockSupportItemFindOne.mockReturnValue({
      sort: () => ({
        lean: async () => ({ supportItemNumber: '01_451_0107_1_1', price: 88.5 }),
      }),
    });

    await generateCrisisInvoice();

    expect(mockSupportItemFindOne).toHaveBeenCalledWith(crisISUPPORT_QUERY);
    const line = crisisLineOf();
    expect(line).toMatchObject({ price: 88.5, totalPrice: 354 });
  });

  test('falls back to the named default when the catalogue has no crisis row', async () => {
    mockSupportItemFindOne.mockReturnValue({
      sort: () => ({ lean: async () => null }),
    });

    await generateCrisisInvoice();

    const line = crisisLineOf();
    expect(line).toMatchObject({ price: 65.47, totalPrice: 261.88 });
  });

  test('falls back to the named default when the catalogue lookup throws', async () => {
    mockSupportItemFindOne.mockImplementation(() => {
      throw new Error('catalog unavailable');
    });

    await generateCrisisInvoice();

    const line = crisisLineOf();
    expect(line).toMatchObject({ price: 65.47, totalPrice: 261.88 });
  });
});
