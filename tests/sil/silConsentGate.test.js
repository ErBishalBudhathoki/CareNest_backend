/**
 * Milestone 4.2: Service Agreement & Participant Consent Gate Tests
 * Verifies that:
 * 1. An active signed Service Agreement is required before transitioning an RoC to 'active'.
 * 2. Unsigned/draft or expired agreements are rejected with SERVICE_AGREEMENT_REQUIRED.
 * 3. Auditable emergency consent bypass allows administrative activation with audit log.
 * 4. Signing agreement transitions status to 'signed'.
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

const mockAgreementFindOne = jest.fn();
const mockAgreementFind = jest.fn();
const mockAgreementCreate = jest.fn();
jest.mock('../../models/ServiceAgreement', () => ({
  findOne: (...args) => mockAgreementFindOne(...args),
  find: (...args) => mockAgreementFind(...args),
  create: (...args) => mockAgreementCreate(...args),
}));

const serviceAgreementService = require('../../services/serviceAgreementService');
const silRosterOfCareService = require('../../services/silRosterOfCareService');

describe('Milestone 4.2: Service Agreement & Consent Gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ServiceAgreementService.checkActiveAgreement', () => {
    test('returns false when no service agreement exists for participant', async () => {
      // First findOne for active/signed agreement returns null
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(null),
      });
      // Second findOne for any agreement returns null
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(null),
      });

      const result = await serviceAgreementService.checkActiveAgreement('org1', 'c1');
      expect(result.hasActiveAgreement).toBe(false);
      expect(result.agreement).toBeNull();
      expect(result.reason).toContain('No Service Agreement exists');
    });

    test('returns false when service agreement is still in draft / unsigned', async () => {
      // First findOne (active/signed) returns null
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(null),
      });
      // Second findOne returns draft agreement
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () =>
          Promise.resolve({
            _id: 'sa1',
            agreementNumber: 'SA-2026-001',
            status: 'draft',
          }),
      });

      const result = await serviceAgreementService.checkActiveAgreement('org1', 'c1');
      expect(result.hasActiveAgreement).toBe(false);
      expect(result.agreement._id).toBe('sa1');
      expect(result.reason).toContain('in draft status and has not been signed');
    });

    test('returns true when an active signed agreement covers the date', async () => {
      const activeAgreement = {
        _id: 'saActive1',
        agreementNumber: 'SA-2026-099',
        status: 'signed',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-12-31'),
        signedAt: new Date('2026-01-02'),
      };

      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(activeAgreement),
      });

      const result = await serviceAgreementService.checkActiveAgreement('org1', 'c1', new Date('2026-04-01'));
      expect(result.hasActiveAgreement).toBe(true);
      expect(result.agreement._id).toBe('saActive1');
    });
  });

  describe('SILRosterOfCareService.update Consent Gate', () => {
    test('blocks transition to active status when no signed agreement exists', async () => {
      const mockSave = jest.fn();
      const draftRoc = {
        _id: 'roc1',
        clientId: 'c1',
        status: 'draft',
        supports: [],
        history: [],
        save: mockSave,
      };
      mockRocFindOne.mockResolvedValue(draftRoc);

      // No active agreement
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(null),
      });
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(null),
      });

      const result = await silRosterOfCareService.update('org1', 'roc1', { status: 'active' }, 'admin@org.com');

      expect(result.consentRequired).toBe(true);
      expect(result.code).toBe('SERVICE_AGREEMENT_REQUIRED');
      expect(result.message).toContain('No Service Agreement exists');
      expect(mockSave).not.toHaveBeenCalled();
      expect(draftRoc.status).toBe('draft');
    });

    test('allows transition to active status when an active signed agreement exists', async () => {
      const mockSave = jest.fn().mockResolvedValue(true);
      const draftRoc = {
        _id: 'roc1',
        clientId: 'c1',
        status: 'draft',
        supports: [],
        history: [],
        save: mockSave,
      };
      mockRocFindOne.mockResolvedValue(draftRoc);

      const activeAgreement = {
        _id: 'saActive1',
        agreementNumber: 'SA-2026-099',
        status: 'signed',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      };
      mockAgreementFindOne.mockReturnValueOnce({
        sort: () => Promise.resolve(activeAgreement),
      });

      const result = await silRosterOfCareService.update('org1', 'roc1', { status: 'active' }, 'admin@org.com');

      expect(result.consentRequired).toBeUndefined();
      expect(result.status).toBe('active');
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    test('allows emergency bypass of consent gate and records audit history', async () => {
      const mockSave = jest.fn().mockResolvedValue(true);
      const draftRoc = {
        _id: 'roc1',
        clientId: 'c1',
        status: 'draft',
        supports: [],
        history: [],
        save: mockSave,
      };
      mockRocFindOne.mockResolvedValue(draftRoc);

      const result = await silRosterOfCareService.update(
        'org1',
        'roc1',
        {
          status: 'active',
          bypassConsent: true,
          bypassReason: 'Crisis SIL admission under NDIA hospital discharge escalation',
        },
        'admin@org.com',
      );

      expect(result.consentRequired).toBeUndefined();
      expect(result.status).toBe('active');
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(draftRoc.history.some((h) => h.change.includes('Consent Gate bypassed'))).toBe(true);
      expect(draftRoc.history.some((h) => h.change.includes('NDIA hospital discharge escalation'))).toBe(true);
    });
  });

  describe('ServiceAgreementService.sign', () => {
    test('signs agreement and transitions status to signed', async () => {
      const mockSave = jest.fn().mockResolvedValue(true);
      const draftAgreement = {
        _id: 'sa1',
        status: 'draft',
        save: mockSave,
      };
      mockAgreementFindOne.mockResolvedValue(draftAgreement);

      const signed = await serviceAgreementService.sign(
        'org1',
        'sa1',
        {
          name: 'Jane Doe',
          role: 'guardian',
          signatureData: 'data:image/png;base64,mockSignature...',
          ipAddress: '192.168.1.1',
        },
        'admin@org.com',
      );

      expect(signed.status).toBe('signed');
      expect(signed.signedAt).toBeDefined();
      expect(signed.signedBy).toMatchObject({
        name: 'Jane Doe',
        role: 'guardian',
        ipAddress: '192.168.1.1',
      });
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });
});

