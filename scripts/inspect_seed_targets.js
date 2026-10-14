/* eslint-disable no-console */
/**
 * Read-only helper: list candidate organisations/users/clients so the NDIS+SIL
 * mock seed can target the org the emulator is actually logged into.
 * Prints identifiers only — no credentials.
 */
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || 'Invoice';
  if (!uri) throw new Error('MONGODB_URI missing');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const orgs = await db.collection('organizations').find({}).limit(20).toArray();
  console.log(`\nOrganisations (${orgs.length}):`);
  for (const o of orgs) {
    const clientCount = await db.collection('clients').countDocuments({ organizationId: String(o._id) });
    const userCount = await db.collection('users').countDocuments({ organizationId: String(o._id) });
    console.log(
      `  _id=${o._id} code=${o.organizationCode || o.code || '-'} name="${o.name || '-'}" ` +
        `owner=${o.ownerEmail || '-'} abn=${o.abn || '-'} ndisReg=${o.ndisRegistration?.registrationNumber || '-'} ` +
        `clients=${clientCount} users=${userCount}`,
    );
  }

  const users = await db
    .collection('users')
    .find({}, { projection: { email: 1, organizationId: 1, role: 1, firstName: 1, lastName: 1 } })
    .limit(20)
    .toArray();
  console.log(`\nUsers (${users.length} shown):`);
  for (const u of users) {
    console.log(`  ${u.email} | org=${u.organizationId || '-'} role=${u.role || '-'}`);
  }

  const clients = await db
    .collection('clients')
    .find({}, { projection: { clientEmail: 1, organizationId: 1, fundingType: 1, ndisNumber: 1 } })
    .limit(15)
    .toArray();
  console.log(`\nClients (${clients.length} shown):`);
  for (const c of clients) {
    console.log(`  ${c.clientEmail} | org=${c.organizationId || '-'} funding=${c.fundingType || '-'} ndis=${c.ndisNumber || '-'}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
