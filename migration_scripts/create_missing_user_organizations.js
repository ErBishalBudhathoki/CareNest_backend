/**
 * Migration Script: Create Missing UserOrganization Records
 * 
 * This script creates UserOrganization records for all users who have an organizationId
 * but are missing the corresponding UserOrganization entry.
 * 
 * Run with: node backend/migration_scripts/create_missing_user_organizations.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function createMissingUserOrganizations() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const userOrgsCollection = db.collection('userorganizations');

    // Get all users with organizationId (handle both string and ObjectId)
    const usersWithOrg = await usersCollection.find({
      organizationId: { $ne: null, $ne: '' }
    }).toArray();

    console.log(`📊 Found ${usersWithOrg.length} users with organizationId`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of usersWithOrg) {
      try {
        // Check if UserOrganization already exists
        const existingUserOrg = await userOrgsCollection.findOne({
          userId: user._id.toString(),
          organizationId: user.organizationId.toString()
        });

        if (existingUserOrg) {
          console.log(`⏭️  Skipping ${user.email} - UserOrganization already exists`);
          skipped++;
          continue;
        }

        // Determine role from user record
        let role = 'user';
        if (user.roles && user.roles.length > 0) {
          role = user.roles[0];
        } else if (user.role) {
          role = user.role;
        }

        // Create UserOrganization record
        const userOrgRecord = {
          userId: user._id.toString(),
          organizationId: user.organizationId.toString(),
          role: role,
          permissions: role === 'admin' || role === 'owner' ? ['*'] : ['read', 'write'],
          isActive: user.isActive !== false,
          joinedAt: user.createdAt || new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await userOrgsCollection.insertOne(userOrgRecord);
        console.log(`✅ Created UserOrganization for ${user.email} (${role})`);
        created++;

      } catch (error) {
        console.error(`❌ Error processing ${user.email}:`, error.message);
        errors++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📊 Total Users: ${usersWithOrg.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Migration completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  createMissingUserOrganizations();
}

module.exports = { createMissingUserOrganizations };
