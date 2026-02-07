const mongoose = require('mongoose');
const UserOrganization = require('./models/UserOrganization');
require('dotenv').config();

async function debugMongoose() {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to:', uri.replace(/:([^@]+)@/, ':****@'));
    
    await mongoose.connect(uri, { dbName: 'Invoice' });
    console.log('Connected to DB');
    
    // 1. Check Model Configuration
    console.log('Model Collection Name:', UserOrganization.collection.name);
    
    // 2. Create a test record
    const testId = new mongoose.Types.ObjectId();
    const testOrgId = new mongoose.Types.ObjectId();
    
    console.log('Creating test record with userId:', testId);
    
    const newRec = await UserOrganization.create({
      userId: testId,
      organizationId: testOrgId,
      role: 'employee',
      permissions: ['read'],
      isActive: true
    });
    
    console.log('Created record ID:', newRec._id);
    
    // 3. Verify with Mongoose
    const foundMongoose = await UserOrganization.findById(newRec._id);
    console.log('Found with Mongoose:', !!foundMongoose);
    
    // 4. Verify with Native Driver (in both potential collections)
    const db = mongoose.connection.db;
    
    const count1 = await db.collection('userorganizations').countDocuments({ _id: newRec._id });
    console.log('Count in "userorganizations":', count1);
    
    const count2 = await db.collection('user_organizations').countDocuments({ _id: newRec._id });
    console.log('Count in "user_organizations":', count2);
    
    // 5. Check existing records
    const allDocs = await UserOrganization.find({});
    console.log('Total documents visible to Mongoose:', allDocs.length);
    if (allDocs.length > 0) {
      console.log('Sample userId type:', typeof allDocs[0].userId);
      console.log('Sample userId value:', allDocs[0].userId);
    }

    // Cleanup
    await UserOrganization.deleteOne({ _id: newRec._id });
    console.log('Cleaned up test record');
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('Error:', error);
  }
}

debugMongoose();
