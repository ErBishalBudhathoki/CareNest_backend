const crypto = require('crypto');
const { admin } = require('../firebase-admin-config');
const logger = require('../config/logger');
const { scopePath } = require('../utils/envScope');

class InvoiceArtifactService {
  _normalizeString(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).trim();
    return normalized || fallback;
  }

  _sanitizeSegment(value, fallback = 'unknown') {
    const normalized = this._normalizeString(value, fallback);
    const sanitized = normalized.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized || fallback;
  }

  _resolveBucketName() {
    const explicit = this._normalizeString(process.env.FIREBASE_STORAGE_BUCKET);
    if (explicit) return explicit;
    const projectId = this._normalizeString(process.env.FIREBASE_PROJECT_ID);
    return projectId ? `${projectId}.appspot.com` : '';
  }

  /**
   * Deterministic, environment-scoped object key.
   *
   * A Temporal/HTTP retry used to produce a new path every attempt because the
   * key contained Date.now() and Math.random(). Each retry therefore uploaded
   * an orphan PDF while the invoice record only ever pointed at one of them.
   * The key is now derived from the invoice number and the PDF bytes, so a
   * replay of the same request overwrites the same object. Stored artifacts
   * keep their original absolute path and remain readable by
   * downloadPdfAsBase64().
   */
  _buildStoragePath({ organizationId, clientEmail, invoiceNumber, pdfBuffer }) {
    const org = this._sanitizeSegment(organizationId, 'org');
    const client = this._sanitizeSegment(clientEmail, 'client');
    const invoice = this._sanitizeSegment(invoiceNumber, 'invoice');
    const digest = crypto
      .createHash('sha256')
      .update(pdfBuffer || Buffer.alloc(0))
      .digest('hex')
      .slice(0, 20);
    const fileName = `${invoice}_${digest}.pdf`;
    return {
      fileName,
      path: scopePath(`invoice_artifacts/${org}/${client}/${fileName}`),
    };
  }

  async uploadPdfBase64({ pdfBase64, organizationId, clientEmail, invoiceNumber }) {
    const raw = this._normalizeString(pdfBase64);
    if (!raw) return null;

    const base64Payload = raw.includes(',') ? raw.split(',').pop() : raw;
    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer.length) {
      throw new Error('Invoice artifact payload is empty');
    }

    const bucketName = this._resolveBucketName();
    if (!bucketName) {
      throw new Error('Firebase Storage bucket is not configured');
    }

    const bucket = admin.storage().bucket(bucketName);
    const storage = this._buildStoragePath({
      organizationId,
      clientEmail,
      invoiceNumber,
      pdfBuffer: buffer,
    });
    const file = bucket.file(storage.path);
    const uploadedAt = new Date().toISOString();

    await file.save(buffer, {
      resumable: false,
      contentType: 'application/pdf',
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          organizationId: this._normalizeString(organizationId),
          clientEmail: this._normalizeString(clientEmail),
          invoiceNumber: this._normalizeString(invoiceNumber),
          source: 'invoice_backend',
          uploadedAt,
        },
      },
    });

    return {
      provider: 'firebase_storage',
      bucket: bucketName,
      path: storage.path,
      fileName: storage.fileName,
      gsUri: `gs://${bucketName}/${storage.path}`,
      sizeBytes: buffer.length,
      contentType: 'application/pdf',
      uploadedAt,
    };
  }

  async downloadPdfAsBase64(artifact) {
    if (!artifact || typeof artifact !== 'object') return null;

    const bucketName = this._normalizeString(
      artifact.bucket,
      this._resolveBucketName()
    );
    const filePath = this._normalizeString(artifact.path);
    if (!bucketName || !filePath) return null;

    const bucket = admin.storage().bucket(bucketName);
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) return null;

    const [bytes] = await file.download();
    if (!bytes || !bytes.length) return null;
    return bytes.toString('base64');
  }

  async downloadPdfFromUrlAsBase64(url) {
    const normalizedUrl = this._normalizeString(url);
    if (!normalizedUrl) return null;

    try {
      const response = await fetch(normalizedUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer.length ? buffer.toString('base64') : null;
    } catch (error) {
      logger.warn('Failed to download legacy invoice artifact URL', {
        url: normalizedUrl,
        error: error.message,
      });
      return null;
    }
  }
}

module.exports = { invoiceArtifactService: new InvoiceArtifactService() };
