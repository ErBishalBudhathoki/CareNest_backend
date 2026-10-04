/**
 * One-time migration: wrap legacy plaintext invoicingBusinessKey values with
 * the server wrap secret (AES-256-GCM, 'w2:' prefix), matching the controller
 * write path. Reads the wrap secret from secrets.json (development) — never
 * logs it. Run: node scripts/migrate_wrap_invoicing_keys.js
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const secrets = require('./secrets.json');
const devUri = secrets.development.MONGODB_URI;
const devDb = secrets.development.DB_NAME || process.env.MONGODB_DATABASE || 'Invoice';
if (!devUri) { console.error('Missing development MONGODB_URI in secrets.json'); process.exit(1); }
const wrapSecret = secrets.development.INVOICING_EMAIL_KEY_WRAP_SECRET;
if (!wrapSecret) { console.error('Missing INVOICING_EMAIL_KEY_WRAP_SECRET (development)'); process.exit(1); }
const wrapKey = crypto.createHash('sha256').update(String(wrapSecret)).digest();

function wrap(raw) {
  if (!raw || String(raw).startsWith('w2:')) return raw;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(String(raw), 'utf8')), cipher.final()]);
  return 'w2:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

(async () => {
  await mongoose.connect(devUri, { dbName: devDb, serverSelectionTimeoutMS: 8000 });
  const coll = mongoose.connection.db.collection('invoicingEmailKeys');
  const cursor = coll.find({ invoicingBusinessKey: { $exists: true, $ne: '' } });
  let scanned = 0, wrapped = 0;
  for await (const doc of cursor) {
    scanned++;
    if (String(doc.invoicingBusinessKey).startsWith('w2:')) continue;
    await coll.updateOne({ _id: doc._id }, { $set: { invoicingBusinessKey: wrap(doc.invoicingBusinessKey) } });
    wrapped++;
  }
  console.log(`scanned=${scanned} wrapped=${wrapped}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
