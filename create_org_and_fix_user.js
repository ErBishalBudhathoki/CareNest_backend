/**
 * Create Missing Organization and Update User Fields
 * 
 * This script creates the missing organization record and ensures
 * all user fields are properly set for authorization.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'Invoice';

async function createOrganizationAndFixUser() {
    const client = new MongoClient(MONGODB_URI, {
        tls: true,
        family: 4
    });

    try {
        console.log('🔌 Connecting to MongoDB Atlas (dev)...');
        await client.connect();
        console.log('✅ Connected successfully!\n');

        const db = client.db(DB_NAME);
        const orgsCollection = db.collection('organizations');
        const usersCollection = db.collection('users');

        const testEmail = 'test1@tester.com';
        const orgId = '6846b040808f01d85897bbd8';

        // Step 1: Check if organization exists
        console.log('=== ORGANIZATION CHECK ===');
        let org = await orgsCollection.findOne({ _id: orgId });

        if (!org) {
            console.log(`❌ Organization ${orgId} does not exist. Creating it...\n`);

            const newOrg = {
                _id: orgId,
                name: 'Test Organization',
                code: 'TEST-ORG',
                abn: '11223344556',
                email: 'admin@testorg.com',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                settings: {
                    currency: 'AUD',
                    timezone: 'Australia/Sydney',
                    invoicePrefix: 'INV',
                    expenseApprovalRequired: false
                }
            };

            await orgsCollection.insertOne(newOrg);
            console.log('✅ Organization created successfully!\n');

            org = await orgsCollection.findOne({ _id: orgId });
        } else {
            console.log('✅ Organization already exists\n');
        }

        console.log('Organization details:');
        console.log(`  _id: ${org._id}`);
        console.log(`  name: ${org.name}`);
        console.log(`  isActive: ${org.isActive}\n`);

        // Step 2: Update user to ensure all fields are set
        console.log('=== USER UPDATE ===');
        const user = await usersCollection.findOne({ email: testEmail });

        if (!user) {
            console.log(`❌ User ${testEmail} not found!\n`);
            return;
        }

        console.log(`Current user state:`);
        console.log(`  _id: ${user._id}`);
        console.log(`  email: ${user.email}`);
        console.log(`  organizationId: ${user.organizationId}`);
        console.log(`  isActive: ${user.isActive}`);
        console.log(`  roles: ${JSON.stringify(user.roles)}\n`);

        // Update user fields that are undefined
        const updates = {};

        if (user.isActive === undefined) {
            updates.isActive = true;
        }

        if (!user.roles || user.roles.length === 0) {
            updates.roles = ['normal'];
        }

        if (Object.keys(updates).length > 0) {
            console.log('Updating user fields:', updates);
            updates.updatedAt = new Date();

            const result = await usersCollection.updateOne(
                { _id: user._id },
                { $set: updates }
            );

            console.log(`✅ Updated ${result.modifiedCount} user field(s)\n`);
        } else {
            console.log('✅ All user fields are already set correctly\n');
        }

        // Step 3: Final verification
        console.log('=== FINAL VERIFICATION ===');
        const verifiedUser = await usersCollection.findOne({
            email: testEmail,
            organizationId: orgId
        });

        if (verifiedUser) {
            console.log('✅ User verification successful!');
            console.log(`  _id: ${verifiedUser._id}`);
            console.log(`  email: ${verifiedUser.email}`);
            console.log(`  organizationId: ${verifiedUser.organizationId}`);
            console.log(`  isActive: ${verifiedUser.isActive}`);
            console.log(`  roles: ${JSON.stringify(verifiedUser.roles)}\n`);

            console.log('✅ ALL CHECKS PASSED!');
            console.log('🎯 Expense creation should now work!\n');
        } else {
            console.log('❌ User verification failed!\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed.');
    }
}

// Run the script
createOrganizationAndFixUser().catch(console.error);
