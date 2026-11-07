/**
 * Invoice PDF artifacts must have deterministic, environment-scoped keys.
 * A Temporal/HTTP retry of the same upload used to create a new object on
 * every attempt (Date.now() + Math.random()), orphaning PDFs in storage.
 */
const mockFileSave = jest.fn().mockResolvedValue(undefined);
const mockBucketFile = jest.fn(() => ({
  save: (...args) => mockFileSave(...args),
  exists: jest.fn().mockResolvedValue([false]),
  download: jest.fn().mockResolvedValue([Buffer.from('')]),
}));

jest.mock('../../firebase-admin-config', () => ({
  admin: { storage: () => ({ bucket: () => ({ file: (...args) => mockBucketFile(...args) }) }) },
}));

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { invoiceArtifactService: service } = require('../../services/invoiceArtifactService');

const pdf = Buffer.from('%PDF-1.4 deterministic test');
const otherPdf = Buffer.from('%PDF-1.4 a different invoice');
const base = {
  organizationId: 'org-1',
  clientEmail: 'client@example.com',
  invoiceNumber: 'INV-42',
};

describe('invoice artifact storage key', () => {
  test('the same invoice and bytes always resolve to the same path', () => {
    const first = service._buildStoragePath({ ...base, pdfBuffer: pdf });
    const second = service._buildStoragePath({ ...base, pdfBuffer: pdf });
    expect(first.path).toBe(second.path);
    expect(first.fileName).toBe(second.fileName);
  });

  test('different PDF bytes resolve to a different path', () => {
    const first = service._buildStoragePath({ ...base, pdfBuffer: pdf });
    const second = service._buildStoragePath({ ...base, pdfBuffer: otherPdf });
    expect(first.path).not.toBe(second.path);
  });

  test('the path is prefixed with the environment scope', () => {
    const { path } = service._buildStoragePath({ ...base, pdfBuffer: pdf });
    expect(path).toMatch(/^(dev|prod)\/invoice_artifacts\//);
    expect(path).toContain('INV-42_');
    expect(path).toMatch(/\.pdf$/);
  });

  test('uploadPdfBase64 writes to the deterministic scoped path', async () => {
    process.env.FIREBASE_STORAGE_BUCKET = 'test-bucket';
    const result = await service.uploadPdfBase64({
      ...base,
      pdfBase64: pdf.toString('base64'),
    });
    const expected = service._buildStoragePath({ ...base, pdfBuffer: pdf });
    expect(result.path).toBe(expected.path);
    expect(mockBucketFile).toHaveBeenCalledWith(expected.path);
    expect(mockFileSave).toHaveBeenCalledWith(
      pdf,
      expect.objectContaining({ contentType: 'application/pdf', resumable: false }),
    );
  });
});
