const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function normalizeBaseUrl(rawBaseUrl) {
  const base = String(rawBaseUrl || '').trim().replace(/\/+$/, '');
  return `${base}/`;
}

function isPrivateIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b >= 160 && b <= 175) return true;
  return false;
}

function isIPv4Literal(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  return true;
}

function isLikelyLocalHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2') return true;
  return isPrivateIPv4(h);
}

function rewriteUrlOrPath(rawUrlOrPath, newBaseUrl) {
  const cleaned = String(rawUrlOrPath || '').trim().replace(/`/g, '');
  if (!cleaned) return { value: cleaned, changed: false };

  if (cleaned.startsWith('file://')) {
    return { value: cleaned, changed: false };
  }

  const base = normalizeBaseUrl(newBaseUrl);
  let baseUri;
  try {
    baseUri = new URL(base);
  } catch {
    return { value: cleaned, changed: false };
  }

  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      const uri = new URL(cleaned);
      if (!isLikelyLocalHost(uri.hostname)) {
        return { value: uri.toString(), changed: uri.toString() !== cleaned };
      }
      uri.protocol = baseUri.protocol;
      uri.hostname = baseUri.hostname;
      uri.port = baseUri.port;
      return { value: uri.toString(), changed: uri.toString() !== cleaned };
    } catch {
      return { value: cleaned, changed: false };
    }
  }

  let relative = cleaned;
  if (relative.startsWith('/')) relative = relative.slice(1);
  try {
    const resolved = new URL(relative, baseUri);
    return { value: resolved.toString(), changed: resolved.toString() !== cleaned };
  } catch {
    return { value: cleaned, changed: false };
  }
}

function rewriteReceiptFields(expenseDoc, newBaseUrl) {
  const update = {};
  let changedCount = 0;

  const originalReceiptUrl = expenseDoc.receiptUrl;
  if (typeof originalReceiptUrl === 'string') {
    const rewritten = rewriteUrlOrPath(originalReceiptUrl, newBaseUrl);
    if (rewritten.changed) {
      update.receiptUrl = rewritten.value;
      changedCount += 1;
    }
  }

  const originalReceiptFiles = Array.isArray(expenseDoc.receiptFiles)
    ? expenseDoc.receiptFiles
    : null;
  if (originalReceiptFiles) {
    const rewrittenFiles = originalReceiptFiles.map((v) =>
      typeof v === 'string' ? rewriteUrlOrPath(v, newBaseUrl).value : v
    );
    const changed = rewrittenFiles.some((v, i) => v !== originalReceiptFiles[i]);
    if (changed) {
      update.receiptFiles = rewrittenFiles;
      changedCount += 1;
    }
  }

  const originalReceiptPhotos = Array.isArray(expenseDoc.receiptPhotos)
    ? expenseDoc.receiptPhotos
    : null;
  if (originalReceiptPhotos) {
    const rewrittenPhotos = originalReceiptPhotos.map((v) =>
      typeof v === 'string' ? rewriteUrlOrPath(v, newBaseUrl).value : v
    );
    const changed = rewrittenPhotos.some((v, i) => v !== originalReceiptPhotos[i]);
    if (changed) {
      update.receiptPhotos = rewrittenPhotos;
      changedCount += 1;
    }
  }

  return { update, changedCount };
}

async function migrateExpenseReceiptUrls({
  mongoUri,
  dbName,
  newBaseUrl,
  dryRun,
  limit,
}) {
  const client = new MongoClient(mongoUri, { tls: true, family: 4 });
  await client.connect();

  try {
    const db = client.db(dbName);
    const expenses = db.collection('expenses');

    const cursor = expenses.find({});
    let scanned = 0;
    let updatedDocs = 0;
    let updatedFields = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      scanned += 1;
      if (Number.isFinite(limit) && scanned > limit) break;

      const { update, changedCount } = rewriteReceiptFields(doc, newBaseUrl);
      if (changedCount === 0) continue;

      updatedFields += changedCount;

      if (!dryRun) {
        await expenses.updateOne({ _id: doc._id }, { $set: update });
      }

      updatedDocs += 1;
      if (updatedDocs % 200 === 0) {
        console.log(
          `Progress: scanned=${scanned}, updatedDocs=${updatedDocs}, updatedFields=${updatedFields}`
        );
      }
    }

    return { scanned, updatedDocs, updatedFields, dryRun };
  } finally {
    await client.close();
  }
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const dryRun =
    args.has('--dry-run') ||
    (process.env.DRY_RUN || '').toLowerCase() === 'true' ||
    process.env.DRY_RUN === '1';
  const limitValue = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
  const limit = Number.isFinite(limitValue) ? limitValue : undefined;
  return { dryRun, limit };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'Invoice';
  const newBaseUrl =
    process.env.NEW_BASE_URL || process.env.PRODUCTION_URL || process.env.BACKEND_URL;
  const { dryRun, limit } = parseArgs(process.argv);

  if (!mongoUri) {
    throw new Error('MONGODB_URI is required');
  }
  if (!newBaseUrl) {
    throw new Error('NEW_BASE_URL (or PRODUCTION_URL/BACKEND_URL) is required');
  }

  const result = await migrateExpenseReceiptUrls({
    mongoUri,
    dbName,
    newBaseUrl,
    dryRun,
    limit,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        dbName,
        newBaseUrl: normalizeBaseUrl(newBaseUrl),
      },
      null,
      2
    )
  );
}

module.exports = {
  isPrivateIPv4,
  isIPv4Literal,
  isLikelyLocalHost,
  normalizeBaseUrl,
  rewriteUrlOrPath,
  rewriteReceiptFields,
  migrateExpenseReceiptUrls,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
