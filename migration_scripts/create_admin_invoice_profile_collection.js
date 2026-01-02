/**
 * Migration: Create adminInvoiceProfiles collection with a dummy document
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

async function run() {
  const uri = process.env.MONGODB_URI;
  const client = await MongoClient.connect(uri, { serverApi: ServerApiVersion.v1 });
  const db = client.db('Invoice');
  try {
    await db.createCollection('adminInvoiceProfiles').catch(() => {});
    const organizationId = process.env.DEFAULT_ORGANIZATION_ID || 'ORG_DEFAULT';
    const existing = await db.collection('adminInvoiceProfiles').findOne({ organizationId, isActive: true });
    if (!existing) {
      await db.collection('adminInvoiceProfiles').insertOne({
        _id: new ObjectId(),
        organizationId,
        businessName: 'Carenest Pty Ltd',
        businessAddress: '123 Business Road, Sydney, NSW 2000',
        contactEmail: 'admin@carenest.example.com',
        contactPhone: '0400000000',
        taxIdentifiers: { abn: '21212121212' },
        bankDetails: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log('Seeded adminInvoiceProfiles with dummy data');
    } else {
      console.log('Active admin invoice profile already exists, skipping seed');
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
