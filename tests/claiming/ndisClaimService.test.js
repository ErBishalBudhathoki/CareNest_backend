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
  updateMany: jest.fn(),
}));
jest.mock('../../models/Client', () => ({ find: jest.fn() }));
jest.mock('../../models/Organization', () => ({ findOne: jest.fn() }));
// The real module exports the model under `Invoice` (plus the status enums),
// so the mock must mirror that shape.
jest.mock('../../models/Invoice', () => ({ Invoice: { find: jest.fn(), findOne: jest.fn() } }));
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

  test('stores the CSV in R2 under THIS environment namespace', async () => {
    const { scopePath } = require('../../utils/envScope');
    const scopedKey = scopePath('claimBatches/org1/b1.csv');

    isR2Configured.mockReturnValue(true);
    uploadBufferToR2.mockResolvedValue({
      key: scopedKey,
      location: `https://cdn.example.com/${scopedKey}`,
    });

    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    // Dev and prod share one R2 bucket: an unscoped key would let a dev batch
    // overwrite a production claim CSV.
    expect(uploadBufferToR2).toHaveBeenCalledWith(
      expect.objectContaining({
        key: scopedKey,
        contentType: 'text/csv',
      }),
    );
    expect(scopedKey).toMatch(/^(dev|prod|staging|test)\//);
    expect(result.batch.fileRef).toBe(scopedKey);
    expect(result.batch.fileUrl).toBe(`https://cdn.example.com/${scopedKey}`);
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

  test('includes NDIA line items from combination-funded participants and excludes plan/self items', async () => {
    Client.find.mockReturnValue(
      lean([
        {
          _id: 'c_comb',
          fundingType: 'combination',
          ndisNumber: '430999888',
          plan: { categories: [{ categoryNumber: '01', managementType: 'NDIA' }] },
        },
      ]),
    );
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv_comb',
          clientId: 'c_comb',
          createdAt: new Date('2026-04-05T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              fundingRoute: 'ndia_managed',
              quantity: 4,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-05T00:00:00Z'),
            },
            {
              supportItemNumber: '15_056_0128_1_3',
              fundingRoute: 'plan_managed',
              quantity: 2,
              price: 193.99,
              unit: 'H',
              date: new Date('2026-04-05T00:00:00Z'),
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
    expect(result.batch.totals.amount).toBe(325.08); // 4 * 81.27 only
    expect(result.csv).toContain('430999888');
    expect(result.csv).toContain('01_011_0107_1_1');
    expect(result.csv).not.toContain('15_056_0128_1_3');
  });

  test('maps irregular_sil claim type to STANDARD in batch and CSV', async () => {
    Client.find.mockReturnValue(
      lean([{ _id: 'c_sil', fundingType: 'ndia_managed', ndisNumber: '430111222' }]),
    );
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv_sil_irr',
          clientId: 'c_sil',
          createdAt: new Date('2026-04-10T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_451_0107_1_1',
              claimType: 'irregular_sil',
              quantity: 5,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-10T00:00:00Z'),
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
    expect(result.batch.totals.amount).toBe(406.35);
    // Verified: column 14 (ClaimType) is STANDARD, not irregular_sil
    expect(result.csv).toContain(',STANDARD,,');
    expect(result.csv).not.toContain('irregular_sil');
    expect(result.validation.errors).toHaveLength(0);
  });

  test('exports multi-day SIL period date ranges in CSV columns 3 and 4', async () => {
    Client.find.mockReturnValue(
      lean([{ _id: 'c_sil_range', fundingType: 'ndia_managed', ndisNumber: '430555666' }]),
    );
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv_sil_range',
          clientId: 'c_sil_range',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          metadata: {
            silRosterOfCareId: 'roc_123',
            silPeriod: { from: '2026-04-01T00:00:00Z', to: '2026-04-07T00:00:00Z' },
          },
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 14,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-01T00:00:00Z'),
              endDate: new Date('2026-04-07T00:00:00Z'),
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
    const row = result.csv.split('\r\n')[1];
    // Column 3 = 01/04/2026, Column 4 = 07/04/2026
    expect(row).toContain('01/04/2026,07/04/2026');
  });

  test('reconcileBPRF cascades payments and audit history to linked Invoice models', async () => {
    const mockInvoice = {
      _id: 'inv_rec_1',
      financialSummary: { totalAmount: 400.0 },
      payment: { paidAmount: 0, balanceDue: 400.0, status: 'pending', transactions: [] },
      workflow: { status: 'issued' },
      auditTrail: { changeHistory: [] },
      save: jest.fn().mockResolvedValue(true),
    };
    Invoice.findOne.mockResolvedValue(mockInvoice);

    ClaimBatch.findOne.mockResolvedValue({
      _id: 'b_rec_1',
      status: 'submitted',
      totals: { amount: 400.0 },
      save: jest.fn(),
    });

    ClaimLine.findOne.mockImplementation(async ({ claimReference }) => ({
      claimReference,
      invoiceId: 'inv_rec_1',
      status: 'submitted',
      requestedAmount: 400.0,
      save: jest.fn(),
    }));

    ClaimLine.find.mockReturnValue({
      lean: async () => [
        {
          claimReference: 'CN-REF-1',
          invoiceId: 'inv_rec_1',
          status: 'reconciled',
          paidAmount: 400.0,
          requestedAmount: 400.0,
          remittanceReference: 'NDIS-EFT-999',
        },
      ],
    });

    const bprfContent = 'ClaimReference,Status,PaidAmount,RemittanceReference\nCN-REF-1,Accepted,400.00,NDIS-EFT-999';
    const result = await ndisClaimService.reconcileBPRF('org1', 'b_rec_1', bprfContent, 'admin@care.org');

    expect(result.summary.accepted).toBe(1);
    expect(mockInvoice.payment.status).toBe('paid');
    expect(mockInvoice.payment.paidAmount).toBe(400.0);
    expect(mockInvoice.payment.balanceDue).toBe(0);
    expect(mockInvoice.workflow.status).toBe('paid');
    expect(mockInvoice.auditTrail.changeHistory).toHaveLength(1);
    expect(mockInvoice.auditTrail.changeHistory[0].action).toBe('ndis_claim_paid');
    expect(mockInvoice.save).toHaveBeenCalled();
  });
});

describe('NDISClaimService.generateBatch idempotency & period boundaries', () => {
  beforeEach(() => {
    Organization.findOne.mockResolvedValue({
      ndisRegistration: { registrationNumber: '405000123' },
      abn: VALID_ABN,
    });
    Client.find.mockReturnValue(
      lean([{ _id: 'c1', fundingType: 'ndia_managed', ndisNumber: '430123456' }]),
    );
    ClaimLine.find.mockReturnValue(lean([]));
    ClaimBatch.create.mockImplementation(async (doc) => ({ _id: 'b1', ...doc, save: jest.fn() }));
    ClaimLine.insertMany.mockResolvedValue([]);
    isR2Configured.mockReturnValue(false);
    uploadBufferToR2.mockReset();
    ClaimBatch.findOne.mockReset();
  });

  test('an idempotent replay returns the existing batch without creating another', async () => {
    const existing = { _id: 'b-existing', organizationId: 'org1', totals: { lines: 1 } };
    ClaimBatch.findOne.mockResolvedValueOnce(existing);
    ClaimLine.find.mockReturnValueOnce(lean([])).mockReturnValue(lean([]));

    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
      idempotencyKey: 'claim:org1:2026-04-01:2026-04-30:valid',
    });

    expect(result.isIdempotentReplay).toBe(true);
    expect(result.batch).toBe(existing);
    expect(ClaimBatch.findOne).toHaveBeenCalledWith({
      organizationId: 'org1',
      idempotencyKey: 'claim:org1:2026-04-01:2026-04-30:valid',
    });
    expect(ClaimBatch.create).not.toHaveBeenCalled();
  });

  test('a duplicate-key race recovers the winning batch instead of throwing', async () => {
    ClaimBatch.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: 'b-winner',
      organizationId: 'org1',
    });
    const duplicateError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    ClaimBatch.create.mockRejectedValueOnce(duplicateError);
    Invoice.find.mockReturnValue(lean([]));
    ClaimLine.find.mockReturnValue(lean([]));

    const result = await ndisClaimService.generateBatch('org1', {
      from: '2026-04-01',
      to: '2026-04-30',
      idempotencyKey: 'race-key',
    });

    expect(result.isIdempotentReplay).toBe(true);
    expect(result.batch._id).toBe('b-winner');
  });

  test('the last day of the period is inclusive (a late-evening line is claimed)', async () => {
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-last-day',
          clientId: 'c1',
          createdAt: new Date('2026-04-30T23:30:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-30T23:30:00Z'),
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
  });

  test('a DD/MM/YYYY period is parsed day-first, not as US MM/DD', async () => {
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-apr',
          clientId: 'c1',
          createdAt: new Date('2026-04-15T10:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
              date: new Date('2026-04-15T10:00:00Z'),
            },
          ],
        },
      ]),
    );

    const result = await ndisClaimService.generateBatch('org1', {
      from: '01/04/2026',
      to: '30/04/2026',
    });

    expect(result.lineCount).toBe(1);
  });

  // Regression: legacy invoices can carry a display-format (DD/MM/YYYY) string
  // in lineItems[].date. `new Date('01/04/2026')` used to read 4 January and
  // silently drop the line from an April claim.
  test('a DD/MM/YYYY line-item date exports 01/04/2026, not a US-parsed date', async () => {
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-slash',
          clientId: 'c1',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
              date: '01/04/2026',
            },
          ],
        },
      ]),
    );

    const result = await ndisClaimService.generateBatch('org1', {
      from: '01/04/2026',
      to: '30/04/2026',
    });

    expect(result.lineCount).toBe(1);
    const cols = result.csv.split('\r\n')[1].split(',');
    expect(cols[2]).toBe('01/04/2026');
    expect(cols[3]).toBe('01/04/2026');
  });

  // Regression: `new Date('31/12/2026')` is Invalid Date, and the old
  // `.toISOString()` dedupe key threw RangeError, aborting the whole batch.
  test('a day-first date with day > 12 is skipped, not crashed on', async () => {
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-dec',
          clientId: 'c1',
          createdAt: new Date('2026-04-10T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
              date: '31/12/2026',
            },
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
              date: '10/04/2026',
            },
          ],
        },
      ]),
    );

    const result = await ndisClaimService.generateBatch('org1', {
      from: '01/04/2026',
      to: '30/04/2026',
    });

    expect(result.lineCount).toBe(1);
    expect(result.csv.split('\r\n')[1].split(',')[2]).toBe('10/04/2026');
  });

  test('a slash-date SIL period renders day-first in both BPR date columns', async () => {
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-sil-slash',
          clientId: 'c1',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          metadata: { silPeriod: { from: '01/04/2026', to: '07/04/2026' } },
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
            },
          ],
        },
      ]),
    );

    const result = await ndisClaimService.generateBatch('org1', {
      from: '01/04/2026',
      to: '30/04/2026',
    });

    expect(result.lineCount).toBe(1);
    const cols = result.csv.split('\r\n')[1].split(',');
    expect(cols[2]).toBe('01/04/2026');
    expect(cols[3]).toBe('07/04/2026');
  });

  test('a slash-date line is still deduped against an already-claimed line', async () => {
    const claimedLine = {
      invoiceId: 'inv-slash',
      supportNumber: '01_011_0107_1_1',
      serviceDate: new Date('2026-04-01T00:00:00Z'),
    };
    ClaimLine.find
      .mockReturnValueOnce({ select: () => ({ lean: async () => [claimedLine] }) })
      .mockReturnValue(lean([]));
    Invoice.find.mockReturnValue(
      lean([
        {
          _id: 'inv-slash',
          clientId: 'c1',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          lineItems: [
            {
              supportItemNumber: '01_011_0107_1_1',
              quantity: 1,
              price: 81.27,
              unit: 'H',
              date: '01/04/2026',
            },
          ],
        },
      ]),
    );

    const result = await ndisClaimService.generateBatch('org1', {
      from: '01/04/2026',
      to: '30/04/2026',
    });

    expect(result.lineCount).toBe(0);
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

describe('NDIS claim lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Organization.findOne.mockResolvedValue({
      ndisRegistration: { registrationNumber: '405000123' },
      abn: VALID_ABN,
    });
    Client.find.mockReturnValue(lean([]));
    Invoice.find.mockReturnValue(lean([]));
    ClaimLine.find.mockReturnValue(lean([]));
    ClaimLine.insertMany.mockResolvedValue([]);
    ClaimLine.updateMany.mockResolvedValue({ modifiedCount: 1 });
    ClaimBatch.create.mockImplementation(async (doc) => ({
      _id: 'b2',
      ...doc,
      save: jest.fn(),
    }));
    isR2Configured.mockReturnValue(false);
  });

  test('submitBatch marks a generated batch submitted with evidence', async () => {
    const save = jest.fn();
    ClaimBatch.findOne.mockResolvedValue({
      _id: 'b1',
      status: 'generated',
      save,
    });

    const result = await ndisClaimService.submitBatch(
      'org1',
      'b1',
      { portalReference: 'PACE-123' },
      'admin@org.com',
    );

    expect(result.batch.status).toBe('submitted');
    expect(result.batch.submittedBy).toBe('admin@org.com');
    expect(result.batch.portalReference).toBe('PACE-123');
    expect(save).toHaveBeenCalled();
  });

  test('submitBatch refuses a paid batch', async () => {
    ClaimBatch.findOne.mockResolvedValue({ _id: 'b1', status: 'paid', save: jest.fn() });
    const result = await ndisClaimService.submitBatch('org1', 'b1');
    expect(result).toMatchObject({ invalidState: true, status: 'paid' });
  });

  test('recordRemittance records a partial payment and outstanding balance', async () => {
    const save = jest.fn();
    ClaimBatch.findOne.mockResolvedValue({
      _id: 'b1',
      status: 'submitted',
      totals: { amount: 100 },
      remittance: {},
      save,
    });

    const result = await ndisClaimService.recordRemittance(
      'org1',
      'b1',
      { paidAmount: 60, reference: 'REM-1' },
      'admin@org.com',
    );

    expect(result.batch.status).toBe('partial');
    expect(result.batch.remittance.status).toBe('part_paid');
    expect(result.batch.remittance.paidAmount).toBe(60);
    expect(result.outstanding).toBe(40);
    expect(save).toHaveBeenCalled();
  });

  test('recordRemittance marks a fully paid batch paid', async () => {
    ClaimBatch.findOne.mockResolvedValue({
      _id: 'b1',
      status: 'submitted',
      totals: { amount: 100 },
      remittance: {},
      save: jest.fn(),
    });

    const result = await ndisClaimService.recordRemittance('org1', 'b1', {
      paidAmount: 100,
    });
    expect(result.batch.status).toBe('paid');
    expect(result.batch.remittance.status).toBe('paid');
    expect(result.outstanding).toBe(0);
  });

  test('resubmitRejected creates a new batch and links the rejected lines', async () => {
    const originalSave = jest.fn();
    const original = {
      _id: 'b1',
      period: { from: new Date('2026-04-01'), to: new Date('2026-04-30') },
      registrationNumber: '405000123',
      abn: VALID_ABN,
      resubmittedBatchId: null,
      save: originalSave,
    };
    ClaimBatch.findOne.mockResolvedValue(original);

    ClaimLine.find
      .mockReturnValueOnce(
        lean([
          {
            _id: 'l1',
            status: 'rejected',
            clientId: 'c1',
            ndisNumber: '430123456',
            invoiceId: 'inv1',
            supportNumber: '01_011_0107_1_1',
            serviceDate: new Date('2026-04-01'),
            quantity: 0,
            hours: 8,
            unitPrice: 81.27,
            gstCode: 'P2',
            claimType: 'STANDARD',
            cancellationReason: '',
            authorisedBy: '',
            participantApproved: 'Y',
            inKindFundingProgramCode: '',
            requestedAmount: 650.16,
          },
        ]),
      )
      .mockReturnValue(lean([]));

    const result = await ndisClaimService.resubmitRejected('org1', 'b1', 'admin');

    expect(result.lineCount).toBe(1);
    expect(result.batch.resubmissionOf).toBe('b1');
    expect(result.csv).toContain('CN-org1-');
    expect(ClaimLine.insertMany).toHaveBeenCalled();
    expect(ClaimLine.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['l1'] } },
      { $set: { resubmittedInBatchId: 'b2' } },
    );
    expect(original.resubmittedBatchId).toBe('b2');
    expect(originalSave).toHaveBeenCalled();
  });
});

describe('NDISClaimResultsService remittance parsing', () => {
  test('stores paid amounts and marks the batch paid', async () => {
    const batchSave = jest.fn();
    ClaimBatch.findOne.mockResolvedValue({
      _id: 'b1',
      status: 'submitted',
      totals: { amount: 100 },
      remittance: {},
      save: batchSave,
    });
    const lineSave = jest.fn();
    ClaimLine.findOne.mockResolvedValue({
      claimReference: 'r1',
      status: 'pending',
      save: lineSave,
    });

    const result = await ndisClaimResultsService.importResults(
      'org1',
      'b1',
      'ClaimReference,Status,PaidAmount,PaidDate\nr1,paid,100,01/05/2026',
      'admin',
    );

    expect(result.summary.accepted).toBe(1);
    expect(result.batch.status).toBe('paid');
    expect(result.batch.remittance.paidAmount).toBe(100);
    expect(result.batch.remittance.status).toBe('paid');
    expect(lineSave).toHaveBeenCalled();
  });
});
