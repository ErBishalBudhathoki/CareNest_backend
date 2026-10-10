/**
 * Invoice signing and verification.
 *
 * Replaces the zero-width-character "watermark", which never worked: it was an
 * HMAC over the invoice *number* only, its secret lived on the generating
 * device, and package:pdf's base-14 font dropped the zero-width characters so no
 * issued invoice carried one at all.
 *
 * ## Scheme
 *
 * Each device holds an Ed25519 keypair. The private key stays in the platform
 * keystore (Keychain / Keystore); the public key is registered to the backend
 * against `(deviceKeyId, organizationId)`. At generation the device signs a
 * canonical serialisation of the invoice's financial content and embeds the
 * signature, the key id and a content hash in the PDF's Info dictionary.
 *
 * Verification therefore works on any machine, by the developer, or by any
 * device in the organisation, because it needs nothing but the public key table
 * — this is what the old per-device secret could not do.
 *
 * ## Threat model, stated plainly
 *
 * This is tamper-EVIDENCE, not tamper-PROOF. It detects an edited PDF: altering
 * any amount, date or line item breaks the signature. It does not stop someone
 * who has extracted the private key from a compromised or rooted device from
 * signing a fresh forgery. Against that, the mitigation is that a forged
 * document must be signed by a device key the backend has never seen, or by a
 * revoked one — both are flagged.
 *
 * The canonical serialisation below is a contract between the Dart generator and
 * this verifier. It must stay byte-identical on both sides; any change must bump
 * CANONICAL_VERSION and keep the old version verifiable, or every previously
 * issued invoice stops validating.
 */
const crypto = require('crypto');

const CANONICAL_VERSION = 1;

/**
 * Ed25519 keys have no self-describing encoding: the raw key is 32 bytes, while
 * SPKI DER wraps it in a 12-byte header. Node's crypto API wants SPKI, so raw
 * keys are wrapped here rather than forcing every caller to store DER.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Accepts either a raw 32-byte key or a full SPKI DER key, both base64, and
 * returns a Node KeyObject.
 */
function publicKeyFromBase64(publicKeyBase64) {
  const raw = Buffer.from(publicKeyBase64, 'base64');
  if (raw.length === 32) {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
  }
  return crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
}

/**
 * Fixed 2-decimal formatting that is identical on the Dart side.
 *
 * Deliberately not `toFixed(2)`: the two runtimes disagree on tie-breaking, and
 * a single cent of difference makes a valid signature fail to verify.
 */
function fixed2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  const sign = n < 0 ? '-' : '';
  const cents = Math.round(Math.abs(n) * 100);
  return `${sign}${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Code-unit comparison, matching Dart's String.compareTo. */
const codeUnitCmp = (a, b) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * Builds the canonical byte string that is signed.
 *
 * Deliberately ordered and fixed-width:
 *   - line-based so no escaping is needed
 *   - money at 2 decimals, so 100, 100.0 and "100.00" all serialise the same
 *   - items sorted, so two invoices with the same facts always sign identically
 *     regardless of the order they were entered
 *   - sorting by code unit, not locale collation, so the order is identical in
 *     Dart and JavaScript
 *
 * @param {object} invoice invoice-like object
 * @returns {string}
 */
function canonicalContent(invoice) {
  const day = (v) => {
    if (!v) return 'unknown';
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  };

  const items = (invoice.lineItems || invoice.items || [])
    .map((li) => ({
      code: String(li.supportItemNumber || li.itemCode || 'unknown'),
      date: day(li.date),
      hours: fixed2(li.quantity !== undefined ? li.quantity : li.hours),
      rate: fixed2(li.price !== undefined ? li.price : li.rate),
      amount: fixed2(li.totalPrice !== undefined ? li.totalPrice : li.amount),
    }))
    .sort((a, b) =>
      codeUnitCmp(a.code, b.code) ||
      codeUnitCmp(a.date, b.date) ||
      codeUnitCmp(a.amount, b.amount)
    );

  const fin = invoice.financialSummary || {};
  const subtotal = invoice.subtotal !== undefined ? invoice.subtotal : fin.subtotal;
  const tax = invoice.tax !== undefined ? invoice.tax : fin.taxAmount;
  const total = invoice.total !== undefined ? invoice.total : fin.totalAmount;

  const lines = [
    `CarenestInvoice|v${CANONICAL_VERSION}`,
    `invoiceNumber=${String(invoice.invoiceNumber || '')}`,
    `periodStart=${day(invoice.startDate)}`,
    `periodEnd=${day(invoice.endDate)}`,
    `subtotal=${fixed2(subtotal)}`,
    `tax=${fixed2(tax)}`,
    `total=${fixed2(total)}`,
    `itemCount=${items.length}`,
  ];
  items.forEach((it) => {
    lines.push(`item=${it.code}|${it.date}|${it.hours}|${it.rate}|${it.amount}`);
  });

  return `${lines.join('\n')}\n`;
}

/** SHA-256 of the canonical content, hex. Cheap to compare without a key. */
function contentFingerprint(invoice) {
  return crypto.createHash('sha256').update(canonicalContent(invoice), 'utf8').digest('hex');
}

/**
 * Verifies an embedded signature against the canonical form of the record.
 *
 * @param {object} params
 * @param {string} params.signatureBase64 signature from the PDF metadata
 * @param {string} params.publicKeyBase64 registered public key
 * @param {object} params.record the stored invoice
 * @returns {{verified: boolean, reason?: string, expectedFingerprint?: string}}
 */
function verifyInvoiceSignature({ signatureBase64, publicKeyBase64, record }) {
  if (!signatureBase64) return { verified: false, reason: 'no signature embedded' };
  if (!publicKeyBase64) return { verified: false, reason: 'no registered public key' };

  let key;
  try {
    key = publicKeyFromBase64(publicKeyBase64);
  } catch (e) {
    return { verified: false, reason: `registered public key is not a valid Ed25519 key: ${e.message}` };
  }

  let signature;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch (e) {
    return { verified: false, reason: 'signature is not valid base64' };
  }

  const content = Buffer.from(canonicalContent(record), 'utf8');
  let ok = false;
  try {
    ok = crypto.verify(null, content, key, signature);
  } catch (e) {
    // An Ed25519 signature is exactly 64 bytes; anything else makes Node throw
    // rather than return false, which is worth distinguishing in the report.
    return { verified: false, reason: `verification failed: ${e.message}` };
  }

  return {
    verified: ok,
    expectedFingerprint: contentFingerprint(record),
    reason: ok ? undefined : 'signature does not match this content under the registered key',
  };
}

/**
 * Parses the CareNest signature block out of a PDF.
 *
 * The signature is embedded as XMP metadata (`<?xpacket?>` / `x:xmpmeta`), which
 * package:pdf writes uncompressed, so it is readable as plain text in the file.
 * Both an XMP attribute form and a PDF Info dictionary form are accepted, since
 * the generator writes XMP and other producers may use the Info dictionary.
 */
function parseSignatureMetadata(rawText) {
  const fromXmp = (name) => {
    const m = rawText.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
    return m ? m[1] : null;
  };

  const fromInfo = (key) => {
    const literal = rawText.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`, 'i'));
    if (literal) return unescapePdfLiteral(literal[1]);
    const hex = rawText.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]*)>`, 'i'));
    if (hex) return Buffer.from(hex[1].replace(/\s+/g, ''), 'hex').toString('latin1');
    return null;
  };

  const sigXmp = fromXmp('carenest:sig');
  const keyXmp = fromXmp('carenest:keyId');
  const fpXmp = fromXmp('carenest:fp');
  const vXmp = fromXmp('carenest:v');

  return {
    signatureBase64: sigXmp !== null ? sigXmp : fromInfo('CarenestSig'),
    deviceKeyId: keyXmp !== null ? keyXmp : fromInfo('CarenestKeyId'),
    fingerprint: fpXmp !== null ? fpXmp : fromInfo('CarenestFingerprint'),
    canonicalVersion: vXmp !== null ? Number(vXmp) : fromInfo('CarenestVersion'),
  };
}

function unescapePdfLiteral(raw) {
  let s = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '\\') {
      s += raw[i];
      continue;
    }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n === 'n') { s += '\n'; i += 1; }
    else if (n === 'r') { s += '\r'; i += 1; }
    else if (n === 't') { s += '\t'; i += 1; }
    else if (n >= '0' && n <= '7') {
      let oct = n;
      let j = i + 2;
      while (j < raw.length && oct.length < 3 && raw[j] >= '0' && raw[j] <= '7') { oct += raw[j]; j += 1; }
      s += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
    } else { s += n; i += 1; }
  }
  return s.trim();
}

module.exports = {
  CANONICAL_VERSION,
  canonicalContent,
  contentFingerprint,
  verifyInvoiceSignature,
  parseSignatureMetadata,
  publicKeyFromBase64,
};
