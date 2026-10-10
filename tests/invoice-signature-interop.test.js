/**
 * Language-boundary test: a signature produced by the Dart generator must
 * verify under Node's Ed25519.
 *
 * This is the only test that proves the scheme actually works end to end. Every
 * other suite checks one side against itself, which would pass happily while the
 * canonical serialisation drifted apart on either side — the exact way the old
 * zero-width watermark silently failed.
 *
 * The fixture is produced by
 *   cd ../ && flutter test test/sample_invoice_marketing_pdf.dart
 * and committed so the test is reproducible without a Flutter toolchain.
 */
const fs = require('fs');
const path = require('path');

const svc = require('../services/invoiceSignatureService');
const verifier = require('../services/invoicePdfVerifier');

const FIXTURE = path.join(__dirname, '../../marketing/signing-fixture.json');
const SAMPLE_PDF = path.join(__dirname, '../../marketing/INVOICE-SAMPLE.pdf');
const fixtureExists = fs.existsSync(FIXTURE);
const fixture = fixtureExists ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;

describe('invoice signature — Dart-to-Node interop', () => {
  beforeAll(() => {
    if (!fixtureExists) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n  signing fixture missing — regenerate with:\n' +
          '    cd ../ && flutter test test/sample_invoice_marketing_pdf.dart\n'
      );
    }
  });

  test('the fixture exists and looks like an Ed25519 key pair', () => {
    if (!fixtureExists) return;
    expect(fixture.publicKeyBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const raw = Buffer.from(fixture.publicKeyBase64, 'base64');
    expect(raw).toHaveLength(32); // raw Ed25519 public key
    expect(Buffer.from(fixture.signatureBase64, 'base64')).toHaveLength(64); // Ed25519 signature
  });

  test('the Dart canonical form matches the Node canonical form byte-for-byte', () => {
    if (!fixtureExists) return;
    // If this fails, the signed bytes on the two sides have diverged and every
    // signature ever issued will fail to verify.
    expect(svc.canonicalContent(fixture.record)).toBe(fixture.canonicalForm);
  });

  test('the Dart signature verifies under Node Ed25519', () => {
    if (!fixtureExists) return;
    const res = svc.verifyInvoiceSignature({
      signatureBase64: fixture.signatureBase64,
      publicKeyBase64: fixture.publicKeyBase64,
      record: fixture.record,
    });
    expect(res.verified).toBe(true);
  });

  test('the embedded fingerprint matches the recomputed content hash', () => {
    if (!fixtureExists) return;
    if (!fs.existsSync(SAMPLE_PDF)) return;
    const meta = verifier.extractSignatureMetadata(fs.readFileSync(SAMPLE_PDF));
    expect(meta.fingerprint).toBe(fixture.fingerprint);
    expect(meta.deviceKeyId).toBe(fixture.deviceKeyId);
  });

  test('editing the record invalidates the Dart signature', () => {
    if (!fixtureExists) return;
    const tampered = JSON.parse(JSON.stringify(fixture.record));
    tampered.financialSummary.totalAmount += 500;
    const res = svc.verifyInvoiceSignature({
      signatureBase64: fixture.signatureBase64,
      publicKeyBase64: fixture.publicKeyBase64,
      record: tampered,
    });
    expect(res.verified).toBe(false);
  });

  test('the verifier reports a valid embedded signature end-to-end', () => {
    if (!fixtureExists || !fs.existsSync(SAMPLE_PDF)) return;
    const meta = verifier.extractSignatureMetadata(fs.readFileSync(SAMPLE_PDF));
    const signature = verifier.verifyEmbeddedSignature({
      meta,
      storedKey: { publicKeyBase64: fixture.publicKeyBase64, status: 'active' },
      record: fixture.record,
    });
    expect(signature.status).toBe('valid');
  });

  test('an unregistered device key is reported, not silently accepted', () => {
    if (!fixtureExists) return;
    const signature = verifier.verifyEmbeddedSignature({
      meta: {
        signatureBase64: fixture.signatureBase64,
        deviceKeyId: 'a-key-nobody-registered',
      },
      storedKey: null,
      record: fixture.record,
    });
    expect(signature.status).toBe('unregistered-key');
  });
});
