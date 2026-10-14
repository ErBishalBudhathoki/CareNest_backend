/**
 * End-to-end billing test (Phase 4 → 6).
 *
 * Runs the real billing stack against MongoDB: a SIL roster of care is billed
 * into a client invoice, the Invoice pre-save hook stamps the funding route
 * from the participant, and the NDIS claim service consumes exactly the
 * invoices routed to the claim CSV (never the PDF ones).
 *
 * Requires a reachable MongoDB — `MONGODB_URI` from backend/.env (a dedicated
 * `MONGODB_URI_TEST` database takes precedence when set). Every fixture is
 * created under a freshly generated organization and removed in `afterAll`;
 * this suite never wipes pre-existing collections.
 *
 * Run with: `npm run test:e2e`.
 */
jest.unmock('mongoose');
jest.unmock('mongodb');

// The NDIS catalogue sync and object storage are network side effects, not
// billing logic. Stub them so the run is hermetic while still exercising a
// real database, real models and the real route-stamping hook.
jest.mock('../../services/ndisCatalogSyncService', () => ({
  ensureFreshOnAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/cloudFunctionsUpload', () => ({
  isR2Configured: () => false,
  uploadBufferToR2: jest.fn().mockResolvedValue({ key: 'e2e', location: '' }),
}));

const mongoose = require('mongoose');
const Organization = require('../../models/Organization');
const Client = require('../../models/Client');
const Stakeholder = require('../../models/Stakeholder');
const SupportItem = require('../../models/SupportItem');
const SILRosterOfCare = require('../../models/SILRosterOfCare');
const { Invoice } = require('../../models/Invoice');
const InvoiceLineItem = require('../../models/InvoiceLineItem');
const ClaimBatch = require('../../models/ClaimBatch');
const ClaimLine = require('../../models/ClaimLine');
const silBillingService = require('../../services/silBillingService');
const ndisClaimService = require('../../services/ndisClaimService');

const ABN = '53004085616'; // ATO-checksum-valid test ABN
const REGISTRATION = '405000123';
const NDIS_NUMBER = '430000001';

// Unique per run so nothing collides with existing data.
const runStamp = Date.now();
const SUPPORT_NUMBER = `E2E_SIL_${runStamp}`;

const utcDay = (yyyy, mm, dd) => new Date(Date.UTC(yyyy, mm - 1, dd));

describe('E2E: SIL roster of care → invoice → NDIS claim', () => {
  let orgId;
  let client;
  let planManager;
  let roc;
  let planInvoice; // plan-managed artifact (invoice_pdf)
  let claimInvoice; // ndia-managed artifact (claim_csv)

  const period1 = { from: utcDay(2026, 3, 1), to: utcDay(2026, 3, 7) };
  const period2 = { from: utcDay(2026, 3, 8), to: utcDay(2026, 3, 14) };

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
    if (!uri) {
      throw new Error(
        'MONGODB_URI is not configured; set it in backend/.env before running the e2e suite.',
      );
    }
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }

    const OrganizationModel = Organization;
    const org = await OrganizationModel.create({
      name: `E2E SIL Billing ${runStamp}`,
      organizationCode: `E2ESIL${runStamp}`,
      ownerEmail: `e2e-org-${runStamp}@example.com`,
      abn: ABN,
      ndisRegistration: { isRegistered: true, registrationNumber: REGISTRATION },
    });
    orgId = org._id.toString();

    await SupportItem.create({
      supportItemNumber: SUPPORT_NUMBER,
      supportItemName: 'E2E SIL support',
      unit: 'H',
      priceCaps: { national: 200 },
      startDate: utcDay(2020, 1, 1),
      endDate: new Date('9999-12-31T00:00:00.000Z'),
    });

    planManager = await Stakeholder.create({
      organizationId: orgId,
      type: 'plan_manager',
      name: 'E2E Plan Manager',
      email: `e2e-pm-${runStamp}@example.com`,
      company: 'E2E Plan Management Pty Ltd',
    });

    client = await Client.create({
      organizationId: orgId,
      clientFirstName: 'E2E',
      clientLastName: 'Participant',
      clientEmail: `e2e-client-${runStamp}@example.com`,
      clientPhone: '0400000000',
      clientAddress: '1 Test St',
      clientCity: 'Sydney',
      clientState: 'NSW',
      clientZip: '2000',
      fundingType: 'plan_managed',
      ndisNumber: NDIS_NUMBER,
      stakeholders: [
        { stakeholderId: planManager._id, role: 'plan_manager', isPrimary: true },
      ],
    });

    roc = await SILRosterOfCare.create({
      organizationId: orgId,
      clientId: client._id,
      effectiveFrom: utcDay(2026, 3, 1),
      status: 'active',
      reviewSchedule: { cadence: 'quarterly' },
      supports: [
        {
          supportNumber: SUPPORT_NUMBER,
          supportName: 'E2E SIL support',
          shiftType: 'day',
          hoursPerWeek: 21,
          unitPrice: 67.56,
        },
      ],
      createdBy: 'e2e',
    });
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && orgId) {
      // Scoped cleanup: only the unique organization created by this run.
      await Promise.all([
        ClaimLine.deleteMany({ organizationId: orgId }),
        ClaimBatch.deleteMany({ organizationId: orgId }),
        InvoiceLineItem.deleteMany({ organizationId: orgId }),
        Invoice.deleteMany({ organizationId: orgId }),
        SILRosterOfCare.deleteMany({ organizationId: orgId }),
        Stakeholder.deleteMany({ organizationId: orgId }),
        Client.deleteMany({ organizationId: orgId }),
      ]);
    }
    if (mongoose.connection.readyState === 1) {
      await SupportItem.deleteMany({ supportItemNumber: SUPPORT_NUMBER });
      await Organization.deleteMany({ organizationCode: `E2ESIL${runStamp}` });
      await mongoose.connection.close();
    }
  }, 30000);

  test('a plan-managed participant is billed as a plan-manager PDF', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      orgId,
      roc._id.toString(),
      { from: period1.from, to: period1.to },
      'e2e',
    );

    expect(result.invoice).toBeTruthy();
    planInvoice = result.invoice;

    // The funding route is stamped from the participant, not passed in.
    expect(result.billing).toMatchObject({
      fundingType: 'plan_managed',
      recipientType: 'plan_manager',
      artifact: 'invoice_pdf',
    });
    expect(String(result.billing.planManagerStakeholderId)).toBe(
      planManager._id.toString(),
    );

    // Prorated over the 7-day period: 21 h/week × 1 week × $67.56.
    expect(result.invoice.financialSummary.totalAmount).toBeCloseTo(21 * 67.56, 2);
    // The invoice is addressed to a real participant name.
    expect(result.invoice.clientName).toBe('E2E Participant');
  });

  test('once the participant moves to NDIA-managed, a new period bills as a claim CSV', async () => {
    await Client.updateOne(
      { _id: client._id },
      { $set: { fundingType: 'ndia_managed' } },
    );

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      orgId,
      roc._id.toString(),
      { from: period2.from, to: period2.to },
      'e2e',
    );

    expect(result.invoice).toBeTruthy();
    claimInvoice = result.invoice;
    expect(result.billing).toMatchObject({
      fundingType: 'ndia_managed',
      recipientType: 'ndia',
      artifact: 'claim_csv',
    });
  });

  test('the claim batch claims only the claim-routed invoice (no double billing)', async () => {
    const batch = await ndisClaimService.generateBatch(
      orgId,
      { from: period1.from, to: period2.to },
      'e2e',
    );

    expect(batch.lineCount).toBeGreaterThanOrEqual(1);

    const lines = await ClaimLine.find({ organizationId: orgId }).lean();
    const claimedInvoiceIds = lines.map((l) => l.invoiceId.toString());

    // The claim-routed invoice is present; the PDF-routed one is excluded even
    // though the participant is now NDIA-managed.
    expect(claimedInvoiceIds).toContain(claimInvoice._id.toString());
    expect(claimedInvoiceIds).not.toContain(planInvoice._id.toString());

    // A real myplace BPR file: fixed 16-column header, participant NDIS number
    // and the billed support item.
    const header = batch.csv.split('\r\n')[0];
    expect(header).toContain('RegistrationNumber');
    expect(header).toContain('ABN');
    expect(batch.csv).toContain(NDIS_NUMBER);
    expect(batch.csv).toContain(SUPPORT_NUMBER);

    // The claimed line reconciles to the invoice amount.
    const claimed = lines.find(
      (l) => l.invoiceId.toString() === claimInvoice._id.toString(),
    );
    expect(claimed.hours).toBeCloseTo(21, 2);
    expect(claimed.unitPrice).toBeCloseTo(67.56, 2);
    expect(claimed.requestedAmount).toBeCloseTo(21 * 67.56, 2);
  });

  test('the same roster period is never billed twice (idempotency)', async () => {
    const repeat = await silBillingService.generateInvoiceFromRosterOfCare(
      orgId,
      roc._id.toString(),
      { from: period2.from, to: period2.to },
      'e2e',
    );
    expect(repeat.conflict).toBe(true);
    expect(repeat.existingInvoiceId).toBe(claimInvoice._id.toString());
  });
});
