/**
 * Unit & Integration Tests for SIL Absence Tracking & Hospital Leave Billing (Milestone 2.1 & 2.3).
 *
 * Under NDIA guidelines:
 *  - When a SIL participant is admitted to hospital, claims may continue for up to 28 consecutive days.
 *  - After 28 days, claims must pause and any additional absence days are non-claimable.
 *  - For a 35-day hospital stay (5 weeks), only 28 days (4 weeks) are billable.
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

const mockOccupancyFindOne = jest.fn();
const mockOccupancyCreate = jest.fn();
const mockOccupancyFind = jest.fn();
jest.mock('../../models/SILOccupancy', () => ({
  findOne: (...args) => mockOccupancyFindOne(...args),
  create: (...args) => mockOccupancyCreate(...args),
  find: (...args) => mockOccupancyFind(...args),
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
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    generateInvoiceNumber: (...args) => mockGenerateInvoiceNumber(...args),
    createInvoice: (...args) => mockCreateInvoice(...args),
  },
}));

const silBillingService = require('../../services/silBillingService');
const silOccupancyService = require('../../services/silOccupancyService');
const silRatioService = require('../../services/silRatioService');

const noExistingInvoice = () =>
  mockInvoiceFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

describe('Milestone 2.1 — SIL Absence & Hospital Leave Billing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    noExistingInvoice();
    mockGenerateInvoiceNumber.mockResolvedValue('INV-TEST-001');
    mockCreateInvoice.mockImplementation(async (data) => ({
      success: true,
      data: {
        _id: 'inv1',
        ...data,
        billing: { artifact: 'claim_csv' },
      },
    }));
  });

  const standardRoc = {
    _id: 'roc1',
    clientId: 'c1',
    status: 'active',
    supports: [
      {
        supportNumber: '01_011_0107_1_1',
        supportName: 'Assistance With Self-Care Activities',
        hoursPerWeek: 14,
        unitPrice: 70.0,
      },
    ],
  };

  const client = {
    _id: 'c1',
    clientFirstName: 'Hospital',
    clientLastName: 'Patient',
    clientEmail: 'patient@ndis.test',
  };

  test('M2.1 Verification: A 35-day hospital stay bills only the allowable 28 days (4 weeks instead of 5 weeks)', async () => {
    mockRocFindOne.mockResolvedValue(standardRoc);
    mockClientFindOne.mockReturnValue({ lean: async () => client });

    // 35 days = 5 weeks: 2026-10-01 to 2026-11-04
    // Hospital stay started on 2026-10-01, ends on 2026-11-04 (35 days)
    const occupancyWith35DayStay = {
      _id: 'occ1',
      clientId: 'c1',
      absences: [
        {
          _id: 'abs1',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-11-04T00:00:00.000Z'),
          reason: 'hospital',
          maxClaimableDays: 28,
        },
      ],
    };

    mockOccupancyFindOne.mockReturnValue({
      sort: () => ({
        lean: async () => occupancyWith35DayStay,
      }),
    });

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-10-01', to: '2026-11-04', mode: 'roc_quota' },
      'tester',
    );

    expect(result.invoice).toBeDefined();

    // 35 nominal days - 7 unclaimable days = 28 billable days = exactly 4 weeks!
    // Without deduction: 5 weeks * 14 hrs/week = 70 hrs * $70 = $4,900
    // With 28-day cap: 4 weeks * 14 hrs/week = 56 hrs * $70 = $3,920
    const lineItem = result.invoice.lineItems[0];
    expect(lineItem.quantity).toBe(56); // 14 hours * 4 weeks
    expect(lineItem.totalPrice).toBe(3920.0);
    expect(result.invoice.financialSummary.totalAmount).toBe(3920.0);

    // Verify absence deduction metadata
    expect(result.invoice.metadata.silAbsenceDeductions).toBeDefined();
    expect(result.invoice.metadata.silAbsenceDeductions.totalUnclaimableDays).toBe(7);
    expect(result.invoice.metadata.silAbsenceDeductions.billableDays).toBe(28);
    expect(result.invoice.metadata.silAbsenceDeductions.nominalPeriodDays).toBe(35);
    expect(result.invoice.metadata.internalNotes).toContain(
      '7 unclaimable absence days deducted per NDIS hospital leave rules',
    );
  });

  test('A 14-day hospital stay within the 28-day limit causes zero deductions', async () => {
    mockRocFindOne.mockResolvedValue(standardRoc);
    mockClientFindOne.mockReturnValue({ lean: async () => client });

    // 14-day stay (2 weeks)
    const occupancyWith14DayStay = {
      _id: 'occ1',
      clientId: 'c1',
      absences: [
        {
          _id: 'abs1',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-10-14T00:00:00.000Z'),
          reason: 'hospital',
          maxClaimableDays: 28,
        },
      ],
    };

    mockOccupancyFindOne.mockReturnValue({
      sort: () => ({
        lean: async () => occupancyWith14DayStay,
      }),
    });

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-10-01', to: '2026-10-14', mode: 'roc_quota' },
      'tester',
    );

    expect(result.invoice).toBeDefined();
    // 14 days = 2 weeks * 14 hrs = 28 hrs * $70 = $1,960
    expect(result.invoice.lineItems[0].quantity).toBe(28);
    expect(result.invoice.financialSummary.totalAmount).toBe(1960.0);
    expect(result.invoice.metadata.silAbsenceDeductions).toBeUndefined();
  });

  test('A hospital stay starting 20 days prior leaves only 8 claimable days in current month', async () => {
    mockRocFindOne.mockResolvedValue(standardRoc);
    mockClientFindOne.mockReturnValue({ lean: async () => client });

    // Stay began 2026-09-11 (20 days before Oct 1).
    // 28 days of claimable leave ends on 2026-10-08 (8 days into October).
    // Billing period: 2026-10-01 to 2026-10-31 (31 days).
    // Days 2026-10-09 to 2026-10-31 (23 days) are unclaimable.
    // Billable days = 31 - 23 = 8 days.
    const occupancyWithPriorStay = {
      _id: 'occ1',
      clientId: 'c1',
      absences: [
        {
          _id: 'abs1',
          startDate: new Date('2026-09-11T00:00:00.000Z'),
          endDate: new Date('2026-10-31T00:00:00.000Z'),
          reason: 'hospital',
          maxClaimableDays: 28,
        },
      ],
    };

    mockOccupancyFindOne.mockReturnValue({
      sort: () => ({
        lean: async () => occupancyWithPriorStay,
      }),
    });

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-10-01', to: '2026-10-31', mode: 'roc_quota' },
      'tester',
    );

    expect(result.invoice).toBeDefined();
    expect(result.invoice.metadata.silAbsenceDeductions.totalUnclaimableDays).toBe(23);
    expect(result.invoice.metadata.silAbsenceDeductions.billableDays).toBe(8);
  });

  test('Rejects billing if all days in the period are unclaimable absence days', async () => {
    mockRocFindOne.mockResolvedValue(standardRoc);
    mockClientFindOne.mockReturnValue({ lean: async () => client });

    // Stay began 40 days prior, entire current 7-day period is unclaimable
    const occupancyWithExhaustedStay = {
      _id: 'occ1',
      clientId: 'c1',
      absences: [
        {
          _id: 'abs1',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-10-31T00:00:00.000Z'),
          reason: 'hospital',
          maxClaimableDays: 28,
        },
      ],
    };

    mockOccupancyFindOne.mockReturnValue({
      sort: () => ({
        lean: async () => occupancyWithExhaustedStay,
      }),
    });

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-10-01', to: '2026-10-07', mode: 'roc_quota' },
      'tester',
    );

    expect(result.invalidState).toBe(true);
    expect(result.message).toContain('All days in this period were non-claimable absence days');
  });

  test('silOccupancyService.recordAbsence records an absence with default 28 maxClaimableDays', async () => {
    const mockOcc = {
      _id: 'occ1',
      absences: [],
      save: jest.fn().mockResolvedValue(true),
    };
    mockOccupancyFindOne.mockResolvedValue(mockOcc);

    const absence = await silOccupancyService.recordAbsence(
      'org1',
      'occ1',
      {
        startDate: '2026-10-01',
        reason: 'hospital',
        notes: 'Admitted for surgery',
      },
      'admin',
    );

    expect(mockOcc.save).toHaveBeenCalled();
    expect(mockOcc.absences).toHaveLength(1);
    expect(absence.reason).toBe('hospital');
    expect(absence.maxClaimableDays).toBe(28);
    expect(absence.notes).toBe('Admitted for surgery');
  });

  test('silOccupancyService.endAbsence sets the return date', async () => {
    const absenceSubdoc = {
      _id: 'abs1',
      startDate: new Date('2026-10-01'),
      endDate: null,
    };
    const mockOcc = {
      _id: 'occ1',
      absences: {
        id: (id) => (id === 'abs1' ? absenceSubdoc : null),
      },
      save: jest.fn().mockResolvedValue(true),
    };
    mockOccupancyFindOne.mockResolvedValue(mockOcc);

    const ended = await silOccupancyService.endAbsence(
      'org1',
      'occ1',
      'abs1',
      { endDate: '2026-10-20' },
      'admin',
    );

    expect(mockOcc.save).toHaveBeenCalled();
    expect(ended.endDate).toEqual(new Date('2026-10-20'));
  });
});

describe('Milestone 2.3 — Dynamic Ratio & Multi-Participant Cost Splitting', () => {
  test('Splits 4-hour shared shift evenly across 2 present residents (1:2 ratio)', () => {
    const split = silRatioService.calculateParticipantShare({
      shiftHours: 4,
      staffCount: 1,
      presentResidentsCount: 2,
    });

    expect(split.billableHoursPerParticipant).toBe(2);
    expect(split.effectiveRatio).toBe('1:2');
    expect(split.staffCount).toBe(1);
    expect(split.presentResidentsCount).toBe(2);
  });

  test('Dynamic ratio fluctuation: when 1 of 3 residents is on hospital leave, ratio shifts to 1:2', () => {
    // Originally 3 residents (1:3 ratio) -> 6-hour shift was 2 hrs each
    const normal = silRatioService.calculateParticipantShare({
      shiftHours: 6,
      staffCount: 1,
      presentResidentsCount: 3,
    });
    expect(normal.billableHoursPerParticipant).toBe(2);
    expect(normal.effectiveRatio).toBe('1:3');

    // 1 resident in hospital -> 2 present residents (1:2 ratio) -> 6-hour shift becomes 3 hrs each
    const duringAbsence = silRatioService.calculateParticipantShare({
      shiftHours: 6,
      staffCount: 1,
      presentResidentsCount: 2,
    });
    expect(duringAbsence.billableHoursPerParticipant).toBe(3);
    expect(duringAbsence.effectiveRatio).toBe('1:2');
  });

  test('Two staff on active night for 3 participants (2:3 ratio)', () => {
    const split = silRatioService.calculateParticipantShare({
      shiftHours: 9,
      staffCount: 2,
      presentResidentsCount: 3,
    });

    // (9 hrs * 2 staff) / 3 residents = 6 hrs per resident
    expect(split.billableHoursPerParticipant).toBe(6);
    expect(split.effectiveRatio).toBe('2:3');
  });
});
