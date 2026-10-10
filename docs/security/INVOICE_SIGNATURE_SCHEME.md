# Invoice Signature Scheme — Ed25519 in PDF XMP metadata

Replaces the zero-width-character watermark, which never worked. This document is
the contract: read it before changing the serialisation, the metadata element
names, or the key formats. Every previously issued invoice is pinned to whatever
version signed it.

## Why the old watermark had to go

Three independent defects, not one:

1. **It signed the invoice *number*, not the money.** `HMAC(secret, invoiceNumber)`.
   Editing an amount, a date or a line item left the watermark perfectly valid, so
   it could not detect a modified invoice — the thing everyone assumed it did.
2. **The secret never left the device.** It was generated per device in
   SharedPreferences. Verification on any other machine — including the server —
   was therefore impossible. An organisation using several phones had invoices only
   the generating phone could vouch for.
3. **It was not in the files at all.** `package:pdf`'s base-14 Helvetica font has
   no Unicode support, so the zero-width characters were dropped by the PDF writer.
   Verified directly: zero occurrences of U+200B/200C/200D/FEFF in the raw and
   inflated bytes of a freshly generated invoice.

So the anti-tamper watermark had never protected a single issued invoice. A
separate bug — `generateWatermark()` being async but called with `.toString()` —
was a second failure layered on top, embedding the literal string
`Instance of 'Future<String>>'`.

## The scheme

Each device holds an Ed25519 keypair.

| | where it lives |
|---|---|
| private key | platform keystore — Keychain (iOS), Keystore (Android), via `flutter_secure_storage` with `first_unlock` accessibility and encrypted shared prefs |
| public key | backend, registered against `(deviceKeyId, organizationId)` |

At generation the device signs a **canonical serialisation of the invoice's
financial content** and embeds the signature, the key id and a content hash in the
document's **XMP metadata**. Those values are stored uncompressed by
`package:pdf`, so they land in the file reliably — and need no font.

Verification then works on any machine: the backend, the developer's laptop, or any
device in the organisation. The generating device does not have to be present,
because nothing but the public key is needed.

## Why per-device asymmetric rather than one shared org secret

Rejected design: a single secret per organisation, known to every device and to the
server.

- Any device could sign arbitrary invoices for the whole organisation.
- The server had to hold the signing key, making the database itself a target.
- Compromise was total, and revocation meant changing a key everywhere.

With per-device keys:

- A stolen key signs as **one device**, not for the organisation.
- The server holds only **public** keys, so leaking the database does not yield a
  way to forge anything.
- Compromise is contained and revocation is a status flip on one row.
- Multi-device works naturally: each device registers its own key, and the metadata
  says which key signed, so the verifier knows which public key to use.

This is the direct answer to the question "what if an org uses several devices?" —
per-device keys do not cause cross-device verification failure, because
verification depends on the *public* key in the backend, not on the signing device.

## The canonical form is a cross-language contract

```
CarenestInvoice|v1
invoiceNumber=INV-2026-0913-SAMPLE
periodStart=2026-09-07
periodEnd=2026-09-13
subtotal=1541.00
tax=0.00
total=1541.00
itemCount=5
item=01_002_0107_1_1|2026-09-09|5.00|82.57|412.85
...
```

Signed as UTF-8. Properties that must hold on both sides:

- **Fixed 2-decimal money**, computed by scaling to cents and rounding the absolute
  value — *not* `toFixed` or `toStringAsFixed`, whose tie-breaking differs between
  runtimes. Both operate on the same IEEE-754 doubles, so identical arithmetic is
  what guarantees identical bytes.
- **Sorting by code unit**, not locale collation. Dart's `String.compareTo` and
  JavaScript's `<`/`>` both compare UTF-16 code units; a locale-aware comparator
  would order differently and the digests would diverge.
- **Item order is irrelevant** to the result — facts that describe the same invoice
  always sign identically.
- **Bump `CANONICAL_VERSION`** on any change, and keep the old version verifiable.

The pinned bytes live in `backend/tests/invoice-signature.test.js` and are checked
against the Dart generator in
`backend/tests/invoice-signature-interop.test.js`. If the pinned block fails, the
two sides have diverged and **every already-issued signature stops verifying**.

## Metadata

```xml
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:carenest="urn:carenest:invoice-signing:1">
    <rdf:Description carenest:sig="…" carenest:keyId="…" carenest:fp="…" carenest:v="1"/>
  </rdf:RDF>
</x:xmpmeta>
```

XMP rather than page content (needs a font that can encode it) or the Info
dictionary (`PdfInfo` exposes only a fixed set of keys). Emitted via
`pw.Document(metadata: xml)`, which is the library's own supported route.

## Threat model — stated plainly

**This is tamper-EVIDENCE, not tamper-PROOF.**

It detects an edited PDF: altering any amount, date, line item or the client breaks
the signature. Verified by tests that tamper with a real signed document.

It does **not** stop someone who has extracted a private key from a compromised or
rooted device from signing a fresh forgery. Against that, the mitigation is that a
forgery must be signed by a device key the backend has never seen, or by a revoked
one — and the verifier flags both (`unregistered-key`, and a `status` that is not
`active`).

The admin-dev UI states this. Never add language implying otherwise.

## Verifying by hand

```bash
# Regenerate the sample and its signing fixture (frontend repo)
cd .. && flutter test test/sample_invoice_marketing_pdf.dart

# Interop test — Dart signature verified under Node's Ed25519
cd backend && npx jest tests/invoice-signature-interop.test.js
```

`marketing/signing-fixture.json` and `marketing/INVOICE-SAMPLE.pdf` are committed so
the interop test runs without a Flutter toolchain.

## Registering a device key

Devices call `POST /api/invoice-signing/register` with app auth:

```json
{ "deviceKeyId": "…", "publicKeyBase64": "… (32 raw bytes)" }
```

Re-registering the same key id with the same key is a refresh. Re-registering with
a *different* key is rejected with 409: it would silently invalidate every invoice
that device already issued. Rotation must be explicit.

## Files

| file | role |
|---|---|
| `../lib/app/features/invoice/services/invoice_signing_service.dart` | keypair, secure storage, canonical form, XMP construction |
| `../lib/app/features/invoice/services/invoice_pdf_generator_service.dart` | attaches the signature at generation |
| `backend/services/invoiceSignatureService.js` | canonical form, key handling, verification, metadata parsing |
| `backend/models/DeviceSigningKey.js` | public-key registry |
| `backend/routes/invoiceSigning.routes.js` | registration and lookup (app-authenticated) |
| `backend/services/invoicePdfVerifier.js` | PDF parsing + signature + arithmetic + record comparison |

## Registration flow

`InvoiceSigningService.ensureRegistered` is called before signing. It:

1. **skips entirely with no organisation context.** Guessing an organisation and
   binding a signing key to it is what the backend guard rejects, and it is the one
   thing that would undermine the scheme.
2. **returns early if the key is already registered**, cached in memory for the
   session and in secure storage across launches, so it is one call per key rather
   than one per invoice.
3. **fails soft.** A rejected or offline registration leaves the invoice generated
   but unverifiable — the verifier reports `unregistered-key` rather than the
   invoice failing. A flaky connection must not stop someone from invoicing.

The HTTP call is injected as a `KeyRegistrationPoster` rather than hard-coded, so
the path is testable without the network.

## Known gaps

- **The canonical form covers the document's financial facts, not its presentation.**
  Change the logo, the wording or the layout and the signature still verifies,
  correctly: those are not the facts being protected.
- **Registration is per-organisation and first-write-wins.** A device registers a
  key once, bound to the organisation it was signed into. If that device is later
  moved to a different organisation, the existing key stays registered to the old
  one and the verifier reports an organisation mismatch. Deliberate: the
  alternative lets a key be re-pointed at another tenant.
  Change the logo, the wording or the layout and the signature still verifies,
  correctly: those are not the facts being protected.
