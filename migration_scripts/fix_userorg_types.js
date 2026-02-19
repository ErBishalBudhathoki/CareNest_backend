const mongoose = require('mongoose');
require('dotenv').config();

async function fixObjectIdTypes() {
  try {
    const uri = process.env.MONGODB_URI;
    await mongoose.connect(uri, { dbName: 'Invoice' });
    console.log('Connected to DB');
    
    const db = mongoose.connection.db;
    const collection = db.collection('userorganizations');
    
    const docs = await collection.find({}).toArray();
    console.log(`Found ${docs.length} records to check`);
    
    let updated = 0;
    
    for (const doc of docs) {
      let needsUpdate = false;
      let updates = {};
      
      // Fix userId
      if (typeof doc.userId === 'string') {
        try {
          updates.userId = new mongoose.Types.ObjectId(doc.userId);
          needsUpdate = true;
        } catch (e) {
          console.error(`Invalid userId: ${doc.userId}`);
        }
      }
      
      // Fix organizationId
      if (typeof doc.organizationId === 'string') {
        try {
          updates.organizationId = new mongoose.Types.ObjectId(doc.organizationId);
          needsUpdate = true;
        } catch (e) {
          console.error(`Invalid organizationId: ${doc.organizationId}`);
        }
      }
      
      if (needsUpdate) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: updates }
        );
        updated++;
      }
    }
    
    console.log(`Updated ${updated} records`);
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('Error:', error);
  }
}

fixObjectIdTypes();
