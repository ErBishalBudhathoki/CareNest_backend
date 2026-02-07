/**
 * Migration Script: login → users collection
 * Run this ONCE to migrate existing users
 */

const mongoose = require('mongoose');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://bishalkc331:REDACTED_MONGODB_PASSWORD_2@morethaninvoicecluster.xptftb5.mongodb.net/Invoice?retryWrites=true&w=majority';

async function migrateUsers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const loginCollection = mongoose.connection.collection('login');
    const usersCollection = mongoose.connection.collection('users');

    // Get all users from login collection
    const users = await loginCollection.find({}).toArray();
    console.log(`📊 Found ${users.length} users in 'login' collection`);

    if (users.length === 0) {
      console.log('✅ No users to migrate');
      return;
    }

    // Migrate each user
    let migrated = 0;
    let skipped = 0;

    for (const user of users) {
      // Check if user already exists in users collection
      const existingUser = await usersCollection.findOne({ email: user.email });

      if (existingUser) {
        // Update existing user with role from login collection
        const legacyRole = user.role || 'user';
        await usersCollection.updateOne(
          { email: user.email },
          { $set: { roles: [legacyRole] } }
        );
        console.log(`🔄 Updated roles for: ${user.email} → [${legacyRole}]`);
        skipped++;
        continue;
      }

      // Transform user data for users collection
      const legacyRole = user.role || 'user';
      const newUser = {
        email: user.email,
        password: user.password,
        firstName: user.firstName,
        lastName: user.lastName,
        role: legacyRole,  // Keep legacy field
        roles: [legacyRole], // Ensure roles array has the role
        organizationId: user.organizationId,
        organizationCode: user.organizationCode,
        isActive: user.isActive !== false,
        isEmailVerified: user.isEmailVerified || false,
        multiOrgEnabled: user.multiOrgEnabled || false,
        payRate: user.payRate || 0,
        activeAllowances: user.activeAllowances || [],
        refreshTokens: user.refreshTokens || [],
        createdAt: user.createdAt || new Date(),
        updatedAt: new Date(), // Update timestamp
        lastLogin: user.lastLogin
      };

      await usersCollection.insertOne(newUser);
      console.log(`✅ Migrated: ${user.email} with roles: [${legacyRole}]`);
      migrated++;
    }

    console.log(`\n📈 Migration Complete!`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Updated: ${skipped}`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

migrateUsers();
