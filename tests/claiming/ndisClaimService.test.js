/**
 * Tests for Phase 6 NDIS claiming: CSV format (2026-27 myplace template),
 * unique refs, validation gate, BPRF reconciliation and billing routing.
 * Models are mocked.
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
// The real module exports the model under `Invoice` (plus the status enums),
// so the mock must mirror that shape.
jest.mock('../../models/Invoice', () => ({ Invoice: { find: jest.fn() } }));
jest.mock('../../services/priceValidationService', () => ({
  priceValidationService: { validatePrice: jest.fn().mockResolvedValue({ isValid: true }) },
}));
jest.mock('../../services/planBudgetService', () => ({
  validateInvoiceAgainstPlan: jest.fn().mockResolvedValue({ ok: true }),
}));

// Keep the R2 storage path hermetic — `.env` is loaded by tests/setup.js, so the
// real utility would otherwise attempt a live upload during unit tests.
jest.mock('../../utils/cloudFunctionsUpload', () => ({
  isR2Configured: jest.fn(() => false),
  uploadBufferToR2: jest.fn(),
}));

const ClaimBatch = require('../../models/ClaimBatch');
const ClaimLine = require('../../models/ClaimLine');
const Client = require('../../models/Client');
const Organization = require('../../models/Organization');
const { Invoice } = require('../../models/Invoice');
const { priceValidationService } = require('../../services/priceValidationService');
const { isR2Configured, uploadBufferToR2 } = require('../../utils/cloudFunctionsUpload');

const ndisClaimService = require('../../services/ndisClaimService');
const ndisClaimResultsService = require('../../services/ndisClaimResultsService');
const billingRoutingService = require('../../services/billingRoutingService');

const lean = (docs) => ({ lean: async () => docs });

const VALID_ABN = '51824753556'; // ATO ABN (passes checksum)

describe('NDISClaimService.buildCsv (2026-27 myplace template)', () => {
  test('emits the exact 16-column header in order', () => {
    const csv = ndisClaimService.buildCsv([], { registrationNumber: '405000123', abn: VALID_ABN });
    expect(csv).toBe(
      'RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,AuthorisedBy,ParticipantApproved,InKindFundingProgramCode,ClaimType,CancellationReason,ABN',
    );
  });

  test('formats dates as DD/MM/YYYY and fills Hours for hourly items', () => {
    const csv = ndisClaimService.buildCsv(
      [
        {
          ndisNumber: '430123456',
          supportNumber: '01_011_0107_1_1',
          claimReference: 'CN-ORG123-ABCD1234-000001',
          isHourly: true,
          quantity: 0,
          hours: 8,
          unitPrice: 81.27,
          gstCode: 'P2',
          claimType: 'STANDARD',
          cancellationReason: '',
          authorisedBy: '',
          participantApproved: 'Y',
          inKindFundingProgramCode: '',
          serviceDate: new Date('2026-04-01T00:00:00Z'),
        },
      ],
      { registrationNumber: '405000123', abn: VALID_ABN },
    );

    const row = csv.split('\r\n')[1];
    expect(row).toBe(
      `405000123,430123456,01/04/2026,01/04/2026,01_011_0107_1_1,CN-ORG123-ABCD1234-000001,,8.00,81.27,P2,,Y,,STANDARD,,${VALID_ABN}`,
    );
  });

  test('fills Quantity (and blanks Hours) for per-each items', () => {
    const csv = ndisClaimService.buildCsv(
      [
        {
          ndisNumber: '430123456',
          supportNumber: '01_015_0107_1_1',
          claimReference: 'ref',
          isHourly: false,
          quantity: 3,
          hours: 0,
          unitPrice: 10,
          gstCode: 'P2',
          claimType: 'STANDARD',
          participantApproved: 'Y',
          serviceDate: new Date('2026-04-01T00:00:00Z'),
        },
      ],
      { registrationNumber: '405000123', abn: VALID_ABN },
    );
    const cols = csv.split('\r\n')[1].split(',');
    expect(cols[6]).toBe('3.00'); // Quantity
    expect(cols[7]).toBe(''); // Hours
  });

  test('formats dates as DD/MM/YYYY', () => {
    expect(ndisClaimService.formatNdisDate(new Date('2026-12-25T00:00:00Z'))).toBe('25/12/2026');
  });
});

describe('NDISClaimService.isValidAbn', () => {
  test('accepts a valid ABN', () => {
    expect(ndisClaimService.isValidAbn('51824753556')).toBe(true);
    expect(ndisClaimService.isValidAbn('51 824 753 556')).toBe(true);
  });
  test('rejects a bad checksum or length', () => {
    expect(ndisClaimService.isValidAbn('12345678901')).toBe(false);
    expect(ndisClaimService.isValidAbn('405000123')).toBe(false);
  });
});

describe('NDISClaimService.validateLines', () => {
  const baseLine = {
    claimReference: 'ref1',
    ndisNumber: '430123456',
    supportNumber: '01_011_0107_1_1',
    isHourly: true,
    quantity: 0,
    hours: 8,
    unitPrice: 50,
    gstCode: 'P2',
    claimType: 'STANDARD',
    cancellationReason: '',
    participantApproved: 'Y',
    requestedAmount: 400,
    serviceDate: new Date('2026-04-01T00:00:00Z'),
  };

  test('flags an invalid provider registration number', async () => {
    const r = await ndisClaimService.validateLines([baseLine], { registrationNumber: '12', abn: VALID_ABN });
    expect(r.errors.some((e) => e.field === 'RegistrationNumber')).toBe(true);
  });

  test('flags an invalid ABN', async () => {
    const r = await ndisClaimService.validateLines([baseLine], { registrationNumber: '405000123', abn: '12345678901' });
    expect(r.errors.some((e) => e.field === 'ABN')).toBe(true);
  });

  test('flags a missing NDIS number', async () => {
    const r = await ndisClaimService.validateLines([{ ...baseLine, ndisNumber: '' }]);
    expect(r.errors.some((e) => e.field === 'NDISNumber')).toBe(true);
  });

  test('flags both Quantity and Hours present', async () => {
    const r = await ndisClaimService.validateLines([{ ...baseLine, quantity: 2, hours: 8 }]);
    expect(r.errors.some((e) => e.field === 'Quantity/Hours')).toBe(true);
  });

  test('flags neither Quantity nor Hours present', async () => {
    const r = await ndisClaimService.validateLines([{ ...baseLine, quantity: 0, hours: 0 }]);
    expect(r.errors.some((e) => e.field === 'Quantity/Hours')).toBe(true);
  });

  test('flags a bad GST code', async () => {
    const r = await ndisClaimService.validateLines([{ ...baseLine, gstCode: 'P3' }]);
    expect(r.errors.some((e) => e.field === 'GSTCode')).toBe(true);
  });

  test('requires NSCC/NSDH when ClaimType is CANCELLATION', async () => {
    const missing = await ndisClaimService.validateLines([{ ...baseLine, claimType: 'CANCELLATION' }]);
    expect(missing.errors.some((e) => e.field === 'CancellationReason')).toBe(true);

    const ok = await ndisClaimService.validateLines([
      { ...baseLine, claimType: 'CANCELLATION', cancellationReason: 'NSCC' },
    ]);
    expect(ok.errors.some((e) => e.field === 'CancellationReason')).toBe(false);
  });

  test('forbids CancellationReason for non-cancellation claims', async () => {
    const r = await ndisClaimService.validateLines([{ ...baseLine, cancellationReason: 'NSCC' }]);
    expect(r.errors.some((e) => e.field === 'CancellationReason')).toBe(true);
  });

  test('flags a line over the price cap', async () => {
    priceValidationService.validatePrice.mockResolvedValueOnce({ isValid: false, message: 'over cap' });
    const r = await ndisClaimService.validateLines([{ ...baseLine, unitPrice: 999 }]);
    expect(r.errors.some((e) => e.field === 'UnitPrice')).toBe(true);
  });

  test('flags a missing service date (BPR date format)', async () => {
    const r = await ndisClaimService.validateLines([{ ...baseLine, serviceDate: undefined }]);
    expect(r.errors.some((e) => e.field === 'SupportsDeliveredFrom')).toBe(true);
  });

  test('accepts a service date in the BPR format', async () => {
    const r = await ndisClaimService.validateLines([baseLine]);
    expect(r.errors.some((e) => e.field === 'SupportsDeliveredFrom')).toBe(false);
  });
});

describe('NDISClaimService.generateBatch', () => {
  beforeEach(() => {
    Organization.findOne.mockResolvedValue({
      ndisRegistration: { registrationNumber: '405000123' },
      abn: VALID_ABN,
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
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 8,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-01T00:00:00Z'),
            },
          ],
        },
      ]),
    );
    ClaimLine.find.mockReturnValue(lean([]));
    ClaimBatch.create.mockImplementation(async (doc) => ({ _id: 'b1', ...doc, save: jest.fn() }));
    ClaimLine.insertMany.mockResolvedValue([]);
    // `clearMocks` does not reset implementations, so reset the storage mocks
    // explicitly to keep each test independent.
    isR2Configured.mockReturnValue(false);
    uploadBufferToR2.mockReset();
  });

  test('generates a batch with unique refs and stores the CSV', async () => {
    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(result.lineCount).toBe(1);
    expect(result.batch.totals.amount).toBe(650.16);
    expect(result.csv).toContain('CN-org1-');
    const decoded = Buffer.from(result.batch.fileRef, 'base64').toString('utf8');
    expect(decoded).toContain('430123456');
    expect(decoded).toContain('01/04/2026');
    // R2 is unavailable in this test → inline fallback.
    expect(result.batch.storageProvider).toBe('inline');
    expect(result.batch.fileUrl).toBe('');
  });

  test('stores the CSV in R2 with a storage ref when R2 is configured', async () => {
    isR2Configured.mockReturnValue(true);
    uploadBufferToR2.mockResolvedValue({
      key: 'claimBatches/org1/b1.csv',
      location: 'https://cdn.example.com/claimBatches/org1/b1.csv',
    });

    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(uploadBufferToR2).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'claimBatches/org1/b1.csv',
        contentType: 'text/csv',
      }),
    );
    expect(result.batch.fileRef).toBe('claimBatches/org1/b1.csv');
    expect(result.batch.fileUrl).toBe('https://cdn.example.com/claimBatches/org1/b1.csv');
    expect(result.batch.storageProvider).toBe('r2');
  });

  test('falls back to inline base64 when the R2 upload fails', async () => {
    isR2Configured.mockReturnValue(true);
    uploadBufferToR2.mockRejectedValue(new Error('R2 outage'));

    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(result.batch.storageProvider).toBe('inline');
    const decoded = Buffer.from(result.batch.fileRef, 'base64').toString('utf8');
    expect(decoded).toContain('CN-org1-');
  });

  test('rejects the batch when validation fails', async () => {
    Client.find.mockReturnValue(
      lean([{ _id: 'c1', fundingType: 'ndia_managed', ndisNumber: '' }]),
    );
    await expect(
      ndisClaimService.generateBatch('org1', { from: '2026-04-01', to: '2026-04-30' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'CLAIM_VALIDATION_FAILED' });
  });

  test('excludes invoices routed to a PDF (plan/self-managed) from the claim', async () => {
    // The client is NDIA-managed, but one of their invoices was explicitly
    // stamped for the invoice_pdf path (e.g. funding type changed). Only the
    // claim_csv-routed invoice may be claimed — otherwise the work would be
    // both claimed AND invoiced.
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-claim',
          clientId: 'c1',
          billing: { artifact: 'claim_csv' },
          createdAt: new Date('2026-04-01T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 8,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-01T00:00:00Z'),
            },
          ],
        },
        {
          _id: 'inv-pdf',
          clientId: 'c1',
          billing: { artifact: 'invoice_pdf' },
          createdAt: new Date('2026-04-01T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 5,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-01T00:00:00Z'),
            },
          ],
        },
      ]),
    );

    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(result.lineCount).toBe(1);
    expect(result.batch.totals.amount).toBe(650.16);
  });

  test('keeps legacy invoices without a billing block claimable', async () => {
    // Default fixture has no `billing` block → fall back to the client's
    // funding type and remain claimable (backwards compatibility).
    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(result.lineCount).toBe(1);
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
    expect(billing.artifact).toBe('invoice_pdf');
  });

  test('buildInvoiceBilling stamps the artifact consumers rely on', () => {
    expect(billingRoutingService.buildInvoiceBilling({ fundingType: 'ndia_managed' }).artifact).toBe(
      'claim_csv',
    );
    expect(billingRoutingService.buildInvoiceBilling({ fundingType: 'self_managed' }).artifact).toBe(
      'invoice_pdf',
    );
    // Unknown/missing funding type must default to plan-managed (PDF) rather
    // than accidentally claiming an invoice as NDIA.
    expect(billingRoutingService.buildInvoiceBilling({}).artifact).toBe('invoice_pdf');
  });
});

describe('NDISClaimService.validateLines — RequestedAmount (F6.3)', () => {
  test('flags a RequestedAmount that does not equal qty × price', async () => {
    const r = await ndisClaimService.validateLines([
      {
        claimReference: 'r1',
        ndisNumber: '430123456',
        supportNumber: '01_011_0107_1_1',
        isHourly: true,
        quantity: 0,
        hours: 8,
        unitPrice: 81.27,
        gstCode: 'P2',
        claimType: 'STANDARD',
        cancellationReason: '',
        participantApproved: 'Y',
        requestedAmount: 999.99, // wrong
      },
    ]);
    expect(r.errors.some((e) => e.field === 'RequestedAmount')).toBe(true);
  });

  test('accepts a reconciling RequestedAmount', async () => {
    const r = await ndisClaimService.validateLines([
      {
        claimReference: 'r1',
        ndisNumber: '430123456',
        supportNumber: '01_011_0107_1_1',
        isHourly: true,
        quantity: 0,
        hours: 8,
        unitPrice: 81.27,
        gstCode: 'P2',
        claimType: 'STANDARD',
        cancellationReason: '',
        participantApproved: 'Y',
        requestedAmount: 650.16,
      },
    ]);
    expect(r.errors.some((e) => e.field === 'RequestedAmount')).toBe(false);
  });
});

describe('NDISClaimService.validateLines — support item in catalogue', () => {
  test('flags a support number that is not in the catalogue', async () => {
    priceValidationService.validatePrice.mockResolvedValueOnce({
      isValid: false,
      status: 'invalid_item',
      message: 'Support item not found: 99_999_9999_1_1',
    });
    const r = await ndisClaimService.validateLines([
      {
        claimReference: 'r1',
        ndisNumber: '430123456',
        supportNumber: '99_999_9999_1_1',
        isHourly: true,
        quantity: 0,
        hours: 1,
        unitPrice: 10,
        gstCode: 'P2',
        claimType: 'STANDARD',
        cancellationReason: '',
        participantApproved: 'Y',
        requestedAmount: 10,
      },
    ]);
    expect(r.errors.some((e) => e.field === 'SupportNumber')).toBe(true);
  });
});
