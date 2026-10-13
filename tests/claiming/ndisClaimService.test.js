/**
 * Tests for Phase 6 NDIS claiming: CSV format, unique refs, validation gate,
 * BPRF reconciliation and billing routing. Models are mocked.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

jest.mock('../../models/ClaimBatch', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../models/ClaimLine', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  insertMany: jest.fn(),
}));
jest.mock('../../models/Client', () => ({ find: jest.fn() }));
jest.mock('../../models/Organization', () => ({ findOne: jest.fn() }));
jest.mock('../../models/Invoice', () => ({ find: jest.fn() }));
jest.mock('../../services/priceValidationService', () => ({
  priceValidationService: { validatePrice: jest.fn().mockResolvedValue({ isValid: true }) },
}));

const ClaimBatch = require('../../models/ClaimBatch');
const ClaimLine = require('../../models/ClaimLine');
const Client = require('../../models/Client');
const Organization = require('../../models/Organization');
const Invoice = require('../../models/Invoice');
const { priceValidationService } = require('../../services/priceValidationService');

const ndisClaimService = require('../../services/ndisClaimService');
const ndisClaimResultsService = require('../../services/ndisClaimResultsService');
const billingRoutingService = require('../../services/billingRoutingService');

const lean = (docs) => ({ lean: async () => docs });

describe('NDISClaimService.buildCsv', () => {
  test('emits the 16-column header and DD/MM/YYYY rows', () => {
    const csv = ndisClaimService.buildCsv(
      [
        {
          ndisNumber: '430123456',
          supportNumber: '01_011_0107_1_1',
          claimReference: 'CN-ORG123-ABCD1234-000001',
          quantity: 8,
          hours: 8,
          unitPrice: 81.27,
          gstCode: 'P2',
          claimType: 'DIRECT_SERVICE',
          cancellationReason: '',
          serviceDate: new Date('2026-04-01T00:00:00Z'),
          requestedAmount: 650.16,
        },
      ],
      { registrationNumber: '405000123', abn: '12345678901' },
    );

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,ClaimType,CancellationReason,ABN,InKindFundingProgram,ClaimReason,RequestedAmount',
    );
    expect(lines[1]).toBe(
      '405000123,430123456,01/04/2026,01/04/2026,01_011_0107_1_1,CN-ORG123-ABCD1234-000001,8.00,8.00,81.27,P2,DIRECT_SERVICE,,12345678901,,,650.16',
    );
  });

  test('formats dates as DD/MM/YYYY (never ISO)', () => {
    expect(ndisClaimService.formatAuDate(new Date('2026-12-25T00:00:00Z'))).toBe('25/12/2026');
  });
});

describe('NDISClaimService.validateLines', () => {
  test('flags a missing NDIS number', async () => {
    const result = await ndisClaimService.validateLines([
      {
        claimReference: 'ref1',
        ndisNumber: '',
        supportNumber: '01_011_0107_1_1',
        quantity: 1,
        unitPrice: 50,
        requestedAmount: 50,
      },
    ]);
    expect(result.errors.some((e) => e.field === 'NDISNumber')).toBe(true);
  });

  test('flags a requested-amount mismatch', async () => {
    const result = await ndisClaimService.validateLines([
      {
        claimReference: 'ref1',
        ndisNumber: '430123456',
        supportNumber: '01_011_0107_1_1',
        quantity: 2,
        unitPrice: 50,
        requestedAmount: 99,
      },
    ]);
    expect(result.errors.some((e) => e.field === 'RequestedAmount')).toBe(true);
  });

  test('flags a line over the price cap', async () => {
    priceValidationService.validatePrice.mockResolvedValueOnce({
      isValid: false,
      message: 'over cap',
    });
    const result = await ndisClaimService.validateLines([
      {
        claimReference: 'ref1',
        ndisNumber: '430123456',
        supportNumber: '01_011_0107_1_1',
        quantity: 1,
        unitPrice: 999,
        requestedAmount: 999,
      },
    ]);
    expect(result.errors.some((e) => e.field === 'UnitPrice')).toBe(true);
  });
});

describe('NDISClaimService.generateBatch', () => {
  beforeEach(() => {
    Organization.findOne.mockResolvedValue({
      ndisRegistration: { registrationNumber: '405000123' },
      abn: '12345678901',
    });
    Client.find.mockReturnValue(
      lean([{ _id: 'c1', fundingType: 'ndia_managed', ndisNumber: '430123456' }]),
    );
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv1',
          clientId: 'c1',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          lineItems: [
            { supportItemNumber: '01_011_0107_1_1', quantity: 8, price: 81.27, date: new Date('2026-04-01T00:00:00Z') },
          ],
        },
      ]),
    );
    ClaimLine.find.mockReturnValue(lean([]));
    ClaimBatch.create.mockImplementation(async (doc) => ({ _id: 'b1', ...doc, save: jest.fn() }));
    ClaimLine.insertMany.mockResolvedValue([]);
  });

  test('generates a batch with unique refs and stores the CSV', async () => {
    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(result.lineCount).toBe(1);
    expect(result.batch.totals.amount).toBe(650.16);
    expect(result.csv).toContain('CN-org1-');
    // Stored as base64 on the batch.
    const decoded = Buffer.from(result.batch.fileRef, 'base64').toString('utf8');
    expect(decoded).toContain('430123456');
  });

  test('rejects the batch when validation fails', async () => {
    Client.find.mockReturnValue(
      lean([{ _id: 'c1', fundingType: 'ndia_managed', ndisNumber: '' }]),
    );
    await expect(
      ndisClaimService.generateBatch('org1', { from: '2026-04-01', to: '2026-04-30' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'CLAIM_VALIDATION_FAILED' });
  });
});

describe('NDISClaimResultsService.importResults', () => {
  test('reconciles accepted and rejected lines', async () => {
    const batch = { status: 'generated', save: jest.fn() };
    ClaimBatch.findOne.mockResolvedValue(batch);

    const lines = {
      'CN-X-1': { status: 'pending', rejectionReason: '', save: jest.fn() },
      'CN-X-2': { status: 'pending', rejectionReason: '', save: jest.fn() },
    };
    ClaimLine.findOne.mockImplementation(async ({ claimReference }) => lines[claimReference] || null);

    const csv = [
      'ClaimReference,Status,Reason',
      'CN-X-1,Accepted,',
      'CN-X-2,Rejected,Service not in plan',
    ].join('\n');

    const result = await ndisClaimResultsService.importResults('org1', 'b1', csv);

    expect(result.summary.accepted).toBe(1);
    expect(result.summary.rejected).toBe(1);
    expect(batch.status).toBe('partial');
    expect(lines['CN-X-2'].rejectionReason).toBe('Service not in plan');
  });

  test('marks a batch reconciled when all accepted', async () => {
    const batch = { status: 'generated', save: jest.fn() };
    ClaimBatch.findOne.mockResolvedValue(batch);
    ClaimLine.findOne.mockResolvedValue({ status: 'pending', save: jest.fn() });

    const result = await ndisClaimResultsService.importResults(
      'org1',
      'b1',
      'ClaimReference,Status\nCN-Y-1,Accepted',
    );

    expect(result.summary.accepted).toBe(1);
    expect(batch.status).toBe('reconciled');
  });

  test('returns notFound for an unknown batch', async () => {
    ClaimBatch.findOne.mockResolvedValue(null);
    expect((await ndisClaimResultsService.importResults('org1', 'x', 'a,b')).notFound).toBe(true);
  });
});

describe('BillingRoutingService', () => {
  test('routes ndia_managed to a claim CSV', () => {
    const route = billingRoutingService.resolveRoute({ fundingType: 'ndia_managed' });
    expect(route.artifact).toBe('claim_csv');
    expect(route.recipientType).toBe('ndia');
  });

  test('routes plan_managed to a plan-manager PDF', () => {
    const route = billingRoutingService.resolveRoute({ fundingType: 'plan_managed' });
    expect(route.artifact).toBe('invoice_pdf');
    expect(route.recipientType).toBe('plan_manager');
  });

  test('routes self_managed to a participant PDF', () => {
    const route = billingRoutingService.resolveRoute({ fundingType: 'self_managed' });
    expect(route.artifact).toBe('invoice_pdf');
    expect(route.recipientType).toBe('participant');
  });

  test('buildInvoiceBilling picks up the linked plan manager', () => {
    const billing = billingRoutingService.buildInvoiceBilling({
      fundingType: 'plan_managed',
      stakeholders: [{ role: 'plan_manager', stakeholderId: { toString: () => 'pm1' } }],
    });
    expect(billing.planManagerStakeholderId).toBe('pm1');
    expect(billing.recipientType).toBe('plan_manager');
  });
});
