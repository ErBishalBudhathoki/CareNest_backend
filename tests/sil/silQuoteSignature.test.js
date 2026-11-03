/**
 * Milestone 6.1: SIL Quote E-Signature & Service Agreement Auto-Link Unit Tests
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockQuoteFindOne = jest.fn();
jest.mock('../../models/SILQuote', () => ({
  findOne: (...args) => mockQuoteFindOne(...args),
}));

const mockAgreementCreate = jest.fn();
jest.mock('../../models/ServiceAgreement', () => ({
  create: (...args) => mockAgreementCreate(...args),
}));

const silQuoteService = require('../../services/silQuoteService');

describe('Milestone 6.1: SIL Quote E-Signature & Service Agreement Auto-Link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('acceptQuote with digital e-signature records signature and auto-links active ServiceAgreement', async () => {
    const mockQuoteDoc = {
      _id: 'quote123',
      organizationId: 'org1',
      clientId: 'client123',
      propertyId: 'prop123',
      status: 'sent',
      lines: [
        {
          supportNumber: '01_801_0115_1_1',
          priceValidation: { passed: true },
        },
      ],
      signature: null,
      save: jest.fn().mockResolvedValue(true),
    };

    mockQuoteFindOne.mockResolvedValue(mockQuoteDoc);

    const mockAgreementDoc = {
      _id: 'agreement456',
      agreementNumber: 'SA-SIL-TEST-1234',
      status: 'active',
      quoteId: 'quote123',
      clientId: 'client123',
      propertyId: 'prop123',
      signedBy: {
        name: 'Sarah Connor',
        role: 'guardian',
        signatureData: 'data:image/png;base64,sampleSignature',
      },
      participantContribution: {
        boardAndLodgingWeekly: 180,
      },
    };
    mockAgreementCreate.mockResolvedValue(mockAgreementDoc);

    const signaturePayload = {
      signedBy: 'Sarah Connor',
      signatoryRole: 'guardian',
      signatureData: 'data:image/png;base64,sampleSignature',
      ipAddress: '192.168.1.100',
      boardAndLodgingWeekly: 180,
      paymentFrequency: 'fortnightly',
    };

    const result = await silQuoteService.acceptQuote(
      'org1',
      'quote123',
      signaturePayload,
      'admin@carenest.test',
    );

    // Verify quote accepted & signature recorded
    expect(result.quote).toBeDefined();
    expect(result.quote.status).toBe('accepted');
    expect(result.quote.approvedBy).toBe('admin@carenest.test');
    expect(result.quote.signature).toBeDefined();
    expect(result.quote.signature.signedBy).toBe('Sarah Connor');
    expect(result.quote.signature.signatoryRole).toBe('guardian');
    expect(result.quote.signature.signatureData).toBe('data:image/png;base64,sampleSignature');
    expect(result.quote.signature.ipAddress).toBe('192.168.1.100');
    expect(mockQuoteDoc.save).toHaveBeenCalled();

    // Verify ServiceAgreement auto-created with linked quoteId & active status
    expect(result.agreement).toBeDefined();
    expect(result.agreement.status).toBe('active');
    expect(result.agreement.quoteId).toBe('quote123');
    expect(mockAgreementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        clientId: 'client123',
        quoteId: 'quote123',
        status: 'active',
        agreementType: 'sil',
        signedBy: expect.objectContaining({
          name: 'Sarah Connor',
          role: 'guardian',
        }),
        participantContribution: expect.objectContaining({
          boardAndLodgingWeekly: 180,
          paymentFrequency: 'fortnightly',
        }),
      }),
    );
  });

  test('acceptQuote handles legacy string actor and sets default signatory fields', async () => {
    const mockQuoteDoc = {
      _id: 'quote789',
      organizationId: 'org1',
      clientId: 'client789',
      status: 'sent',
      lines: [
        {
          supportNumber: '01_801_0115_1_1',
          priceValidation: { passed: true },
        },
      ],
      signature: null,
      save: jest.fn().mockResolvedValue(true),
    };

    mockQuoteFindOne.mockResolvedValue(mockQuoteDoc);
    mockAgreementCreate.mockResolvedValue({
      _id: 'agreement789',
      status: 'active',
    });

    const result = await silQuoteService.acceptQuote('org1', 'quote789', 'officer@carenest.test');

    expect(result.quote.status).toBe('accepted');
    expect(result.quote.approvedBy).toBe('officer@carenest.test');
    expect(result.quote.signature.signedBy).toBe('officer@carenest.test');
    expect(result.quote.signature.signatoryRole).toBe('participant');
    expect(mockAgreementCreate).toHaveBeenCalled();
  });
});
