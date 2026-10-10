/**
 * Tests for the invoice signature service.
 *
 * The property that matters is interop: the scheme is signed by Dart and
 * verified here, so the canonical serialisation and key formats are checked
 * against Node's own Ed25519 implementation and against hand-built key material,
 * not only against itself.
 */
const crypto = require('crypto');

const svc = require('../services/invoiceSignatureService');

const RAW_PUBLIC_KEY = (publicDer) =>
  crypto.createPublicKey({ key: publicDer, format: 'der', type: 'spki' })
    .export({ format: 'der', type: 'spki' })
    .subarray(12); // strip the 12-byte SPKI header for the raw form

const signedPair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyBase64: RAW_PUBLIC_KEY(publicKey.export({ format: 'der', type: 'spki' })).toString('base64'),
    privateKey,
  };
};

const record = (over = {}) => ({
  invoiceNumber: 'INV-2026-0913-SAMPLE',
  startDate: new Date('2026-09-07T00:00:00.000Z'),
  endDate: new Date('2026-09-13T00:00:00.000Z'),
  financialSummary: { subtotal: 1541.0, taxAmount: 0, totalAmount: 1541.0 },
  lineItems: [
      { supportItemNumber: '01_011_0107_1_1', date: new Date('2026-09-07T00:00:00.000Z'), quantity: 3, price: 73.58, totalPrice: 220.74 },
      { supportItemNumber: '01_011_0107_1_1', date: new Date('2026-09-08T00:00:00.000Z'), quantity: 4.5, price: 73.58, totalPrice: 331.11 },
      { supportItemNumber: '01_002_0107_1_1', date: new Date('2026-09-09T00:00:00.000Z'), quantity: 5, price: 82.57, totalPrice: 412.85 },
      { supportItemNumber: '01_015_0107_1_1', date: new Date('2026-09-10T00:00:00.000Z'), quantity: 2, price: 81.07, totalPrice: 162.14 },
      { supportItemNumber: '01_013_0107_1_1', date: new Date('2026-09-12T00:00:00.000Z'), quantity: 4, price: 103.54, totalPrice: 414.16 },
  ],
  ...over,
});

const sign = (privateKey, invoice) =>
  crypto.sign(null, Buffer.from(svc.canonicalContent(invoice), 'utf8'), privateKey).toString('base64');

describe('invoice signature — canonical content', () => {
  test('is deterministic for the same invoice regardless of item order', () => {
    const a = record();
    const reordered = record({
      lineItems: [...a.lineItems].reverse(),
    });
    expect(svc.canonicalContent(a)).toBe(svc.canonicalContent(reordered));
  });

  test('normalises number formatting', () => {
    const a = record();
    const b = record();
    b.financialSummary.subtotal = '1541.000000';
    b.financialSummary.totalAmount = 1541;
    expect(svc.canonicalContent(a)).toBe(svc.canonicalContent(b));
  });

  test('covers the content, not just the invoice number', () => {
    const a = record();
    const changedAmount = record({ financialSummary: { subtotal: 9999, taxAmount: 0, totalAmount: 9999 } });
    expect(svc.canonicalContent(a)).not.toBe(svc.canonicalContent(changedAmount));
  });

  test('accepts either the financialSummary shape or flat fields', () => {
    const nested = record();
    const flat = record({
      financialSummary: undefined,
      subtotal: 1541.0,
      tax: 0,
      total: 1541.0,
    });
    expect(svc.canonicalContent(nested)).toBe(svc.canonicalContent(flat));
  });

  test('produces a stable fingerprint', () => {
    expect(svc.contentFingerprint(record())).toBe(svc.contentFingerprint(record()));
    expect(svc.contentFingerprint(record())).toHaveLength(64); // sha256 hex
  });
});

describe('invoice signature — verification', () => {
  test('a valid signature verifies', () => {
    const pair = signedPair();
    const r = record();
    const res = svc.verifyInvoiceSignature({
      signatureBase64: sign(pair.privateKey, r),
      publicKeyBase64: pair.publicKeyBase64,
      record: r,
    });
    expect(res.verified).toBe(true);
    expect(res.expectedFingerprint).toBe(svc.contentFingerprint(r));
  });

  test('an edited amount breaks the signature', () => {
    const pair = signedPair();
    const r = record();
    const res = svc.verifyInvoiceSignature({
      signatureBase64: sign(pair.privateKey, r),
      publicKeyBase64: pair.publicKeyBase64,
      // Same invoice, different numbers — exactly the attack this defends against.
      record: record({ financialSummary: { subtotal: 1541.0, taxAmount: 999.0, totalAmount: 2540.0 } }),
    });
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/does not match/);
  });

  test('a signature from a different device does not verify', () => {
    const signer = signedPair();
    const other = signedPair();
    const r = record();
    const res = svc.verifyInvoiceSignature({
      signatureBase64: sign(signer.privateKey, r),
      publicKeyBase64: other.publicKeyBase64,
      record: r,
    });
    expect(res.verified).toBe(false);
  });

  test('a copied signature does not verify against a different invoice', () => {
    const pair = signedPair();
    const a = record();
    const b = record({ invoiceNumber: 'INV-2026-0914-SAMPLE' });
    const res = svc.verifyInvoiceSignature({
      signatureBase64: sign(pair.privateKey, a),
      publicKeyBase64: pair.publicKeyBase64,
      record: b,
    });
    expect(res.verified).toBe(false);
  });

  test('a missing or malformed signature is reported, not thrown', () => {
    const pair = signedPair();
    const r = record();
    expect(svc.verifyInvoiceSignature({ signatureBase64: null, publicKeyBase64: pair.publicKeyBase64, record: r }).verified).toBe(false);
    expect(svc.verifyInvoiceSignature({ signatureBase64: 'not-base64!!', publicKeyBase64: pair.publicKeyBase64, record: r }).verified).toBe(false);
    // A truncated signature must not crash the verifier.
    const good = sign(pair.privateKey, r);
    expect(svc.verifyInvoiceSignature({ signatureBase64: good.slice(0, 20), publicKeyBase64: pair.publicKeyBase64, record: r }).verified).toBe(false);
  });

  test('pins the canonical form byte-for-byte', () => {
    const r = record();
    expect(svc.canonicalContent(r)).toBe(
      [
        'CarenestInvoice|v1',
        'invoiceNumber=INV-2026-0913-SAMPLE',
        'periodStart=2026-09-07',
        'periodEnd=2026-09-13',
        'subtotal=1541.00',
        'tax=0.00',
        'total=1541.00',
        'itemCount=5',
        'item=01_002_0107_1_1|2026-09-09|5.00|82.57|412.85',
        'item=01_011_0107_1_1|2026-09-07|3.00|73.58|220.74',
        'item=01_011_0107_1_1|2026-09-08|4.50|73.58|331.11',
        'item=01_013_0107_1_1|2026-09-12|4.00|103.54|414.16',
        'item=01_015_0107_1_1|2026-09-10|2.00|81.07|162.14',
        '',
      ].join('\n')
    );
  });

  test('formats cents independently of toFixed so both runtimes agree', () => {
    const f = (r) => svc.canonicalContent(record({ financialSummary: { subtotal: r, taxAmount: 0, totalAmount: r } }))
      .split('\n').find((l) => l.startsWith('subtotal=')).slice('subtotal='.length);
    // The property that matters is that Dart's `(x.abs()*100).round()` and this
    // produce the same string, so the signed bytes match. Both operate on the
    // same IEEE-754 doubles, so the only way to guarantee agreement is to use
    // identical arithmetic on both sides rather than relying on each runtime's
    // formatter.
    //
    // Exact-cent values — the realistic case for money — must round-trip.
    expect(f(0)).toBe('0.00');
    expect(f(0.01)).toBe('0.01');
    expect(f(1.5)).toBe('1.50');
    expect(f(1541)).toBe('1541.00');
    expect(f(1541.37)).toBe('1541.37');
    expect(f(123456.78)).toBe('123456.78');
    // Negatives: the sign is applied after the absolute value is rounded, which
    // is what makes Dart's half-away-from-zero and JavaScript's half-up agree.
    expect(f(-0.01)).toBe('-0.01');
    expect(f(-1541.37)).toBe('-1541.37');
    // Half-cent inputs are NOT exactly representable, so both runtimes see the
    // same artifact: 1.005*100 is 100.4999... in IEEE-754, which rounds down.
    // Pinned here so a change in the formatter is visible rather than silently
    // diverging from Dart.
    expect(f(1.005)).toBe('1.00');
    expect(f(0.005)).toBe('0.01');
  });

  test('sorts by code unit, not locale collation', () => {
    // Under a locale-aware collation these order differently, which would make
    // the Dart and Node digests diverge.
    const a = record({ lineItems: [
      { supportItemNumber: 'a_2', quantity: 1, price: 1, totalPrice: 1 },
      { supportItemNumber: 'A_1', quantity: 1, price: 1, totalPrice: 1 },
    ] });
    const lines = svc.canonicalContent(a).split('\n').filter((l) => l.startsWith('item='));
    expect(lines[0]).toBe('item=A_1|unknown|1.00|1.00|1.00');
    expect(lines[1]).toBe('item=a_2|unknown|1.00|1.00|1.00');
  });

  test('a full SPKI DER key is accepted as well as a raw key', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const der = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const r = record();
    const res = svc.verifyInvoiceSignature({
      signatureBase64: crypto.sign(null, Buffer.from(svc.canonicalContent(r), 'utf8'), privateKey).toString('base64'),
      publicKeyBase64: der,
      record: r,
    });
    expect(res.verified).toBe(true);
  });
});

describe('invoice signature — metadata parsing', () => {
  test('reads the signature block from PDF Info text', () => {
    const text = '/CarenestSig (QUJDRA==) /CarenestKeyId (device-abc-123) /CarenestFingerprint (deadbeef)';
    const parsed = svc.parseSignatureMetadata(text);
    expect(parsed.signatureBase64).toBe('QUJDRA==');
    expect(parsed.deviceKeyId).toBe('device-abc-123');
    expect(parsed.fingerprint).toBe('deadbeef');
  });

  test('reads hex-encoded PDF strings', () => {
    const text = '/CarenestKeyId <6465766963652d616263>';
    expect(svc.parseSignatureMetadata(text).deviceKeyId).toBe('device-abc');
  });

  test('returns nulls rather than throwing when absent', () => {
    const parsed = svc.parseSignatureMetadata('/Title (Invoice)');
    expect(parsed.signatureBase64).toBeNull();
    expect(parsed.deviceKeyId).toBeNull();
  });
});
