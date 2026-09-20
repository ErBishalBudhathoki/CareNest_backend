/**
 * One-off migration: rewrite legacy R2 custom-domain file URLs to the
 * R2 API-host form so they keep working through the authenticated
 * files-download proxy after the bucket goes private.
 *
 *   https://<custom-domain>/<key>  →  https://<bucket>.<account>.r2.cloudflarestorage.com/<key>
 *
 * Public branding (Organization.logoUrl) and training content are
 * intentionally left untouched.
 *
 * Usage (dry run first — default):
 *   MONGODB_URI=... DB_NAME=Invoice R2_PUBLIC_DOMAIN=... \
 *     R2_BUCKET_NAME=... R2_ACCOUNT_ID=... node scripts/migrateR2UrlsToApiHost.js
 * Apply:
 *   ... APPLY=true node scripts/migrateR2UrlsToApiHost.js
 */
const mongoose = require('mongoose');

const TARGETS = [
  { collection: 'users', fields: ['photoURL'] },
  { collection: 'certifications', fields: ['fileUrl'] },
  { collection: 'employeedocuments', fields: ['fileUrl'] },
  { collection: 'expenses', fields: ['receiptUrl'] },
];

async function main() {
  const {
    MONGODB_URI,
    DB_NAME = 'Invoice',
    R2_PUBLIC_DOMAIN,
    R2_BUCKET_NAME,
    R2_ACCOUNT_ID,
    APPLY = '',
  } = process.env;

  if (!MONGODB_URI || !R2_PUBLIC_DOMAIN || !R2_BUCKET_NAME || !R2_ACCOUNT_ID) {
    throw new Error(
      'MONGODB_URI, R2_PUBLIC_DOMAIN, R2_BUCKET_NAME and R2_ACCOUNT_ID are required',
    );
  }

  const customHost = R2_PUBLIC_DOMAIN.replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  const apiHost =
    `${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.toLowerCase();
  const apply = String(APPLY).toLowerCase() === 'true';

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    dbName: DB_NAME,
  });
  console.log(`Connected (db: ${DB_NAME}). Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  let totalMatched = 0;
  let totalUpdated = 0;

  for (const { collection, fields } of TARGETS) {
    const coll = mongoose.connection.db.collection(collection);
    for (const field of fields) {
      const regex = new RegExp(`^https?://${customHost.replace(/\./g, '\\.')}/`, 'i');
      const docs = await coll
        .find({ [field]: { $regex: regex } }, { projection: { [field]: 1 } })
        .toArray();
      if (!docs.length) continue;
      console.log(`${collection}.${field}: ${docs.length} legacy URL(s)`);
      totalMatched += docs.length;
      if (!apply) continue;
      const ops = docs.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              [field]: String(d[field]).replace(
                new RegExp(`^(https?://)${customHost.replace(/\./g, '\\.')}/`, 'i'),
                `$1${apiHost}/`,
              ),
            },
          },
        },
      }));
      const res = await coll.bulkWrite(ops, { ordered: false });
      totalUpdated += res.modifiedCount || 0;
    }
  }

  console.log(`Matched: ${totalMatched}, updated: ${totalUpdated}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('MIGRATION_FAILED:', e.message);
  process.exit(1);
});
